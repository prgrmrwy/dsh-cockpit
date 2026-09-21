import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Logger, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
import type { AddDeviceRequest, ApiError, DeviceStatusFacts, UpdateDeviceRequest } from '@dsh-cockpit/shared'
import { ConnectivityService } from '../connectivity/connectivity.service.js'
import { DeviceEventsService } from '../connectivity/device-events.service.js'
import { BRIDGE_CAPABILITY_HEADER } from '../auth/bridge-capability.js'

@Controller('api')
export class DevicesController {
  private readonly logger = new Logger(DevicesController.name)

  constructor(
    @Inject(ConnectivityService) private readonly connectivity: ConnectivityService,
    @Inject(DeviceEventsService) private readonly events: DeviceEventsService,
  ) {}

  /** Server-Sent Events stream of device status snapshots. The browser keeps
   * one EventSource open; every lifecycle change is pushed immediately. */
  @Get('devices/stream')
  stream(@Req() request: import('express').Request, @Res() response: import('express').Response): void {
    response.setHeader('content-type', 'text/event-stream')
    response.setHeader('cache-control', 'no-cache')
    response.setHeader('connection', 'keep-alive')
    response.flushHeaders?.()
    const send = (facts: readonly DeviceStatusFacts[]) => {
      void response.write(`data: ${JSON.stringify({ device: facts })}\n\n`)
    }
    send(this.connectivity.statuses())
    const unsubscribe = this.events.subscribe(send)
    request.on('close', () => { unsubscribe() })
  }

  @Get('devices')
  devices(): { device: readonly DeviceStatusFacts[] } {
    return { device: this.connectivity.statuses() }
  }

  @Post('devices')
  async add(@Body() body: AddDeviceRequest): Promise<{ deviceId: string }> {
    try {
      const record = await this.connectivity.addDevice(requireAdd(body))
      return { deviceId: record.deviceId }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Put('devices/:deviceId')
  async update(
    @Param('deviceId') deviceId: string,
    @Body() body: UpdateDeviceRequest,
  ): Promise<{ deviceId: string }> {
    try {
      await this.connectivity.updateDevice(decodeDeviceId(deviceId), requireUpdate(body))
      return { deviceId }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Delete('devices/:deviceId')
  async remove(
    @Param('deviceId') deviceId: string,
    @Query('confirmed') confirmed: string | undefined,
  ): Promise<{ removed: boolean; requiresConfirmation: boolean }> {
    try {
      return await this.connectivity.removeDevice(decodeDeviceId(deviceId), confirmed === 'true')
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Post('devices/:deviceId/workbench-launch')
  async workbenchLaunch(@Param('deviceId') deviceId: string): Promise<{ url: string; authGeneration: number }> {
    try {
      return await this.connectivity.workbenchLaunch(decodeDeviceId(deviceId))
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Post('devices/:deviceId/refresh')
  async refresh(@Param('deviceId') deviceId: string): Promise<{ refreshed: boolean }> {
    try {
      await this.connectivity.refreshDevice(decodeDeviceId(deviceId))
      return { refreshed: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Reconnects exactly this device; other devices keep their live state. */
  @Post('devices/:deviceId/reconnect')
  async reconnect(@Param('deviceId') deviceId: string): Promise<{ reconnecting: boolean }> {
    try {
      await this.connectivity.reconnectDevice(decodeDeviceId(deviceId))
      return { reconnecting: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Post('devices/:deviceId/completed/ack')
  async ackCompleted(@Param('deviceId') deviceId: string): Promise<{ acked: boolean }> {
    try {
      this.connectivity.ackCompleted(decodeDeviceId(deviceId))
      return { acked: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Issues a short-lived bridge capability. This route is same-origin,
   * cookie-gated by TokenMiddleware exactly like every other `/api/devices`
   * endpoint — it is the cockpit's OWN page (not the device iframe) that
   * calls it, to then relay the result into the device iframe via the
   * postMessage handshake. The capability is bound to the target device's own
   * DSH origin (see ConnectivityService#issueBridgeCapability), which has
   * nothing to do with this caller's origin. */
  @Post('devices/:deviceId/bridge/capability')
  async bridgeCapability(@Param('deviceId') deviceId: string): Promise<{ capability: string; expiresAt: number; protocolVersion: number }> {
    try {
      return this.connectivity.issueBridgeCapability(decodeDeviceId(deviceId))
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Bridge from the device's official DSH web client: its cockpit plugin
   * reports a selected-session snapshot. A request carrying the capability
   * header is validated against it; a request with no header at all can only
   * have reached this handler by already passing the global TokenMiddleware's
   * persistent-cookie gate (bridge routes have no other bypass), so it is
   * accepted as the legacy path and its protocol defaults to 1. */
  @Post('bridge/session-opened')
  async bridgeSessionOpened(
    @Req() request: import('express').Request,
    @Body() body: { sessionId?: unknown; current?: unknown; protocolVersion?: unknown },
  ): Promise<{ opened: boolean; accepted: boolean }> {
    const origin = requireOrigin(request)
    const current = body?.current === null || body?.current === undefined
      ? undefined
      : typeof body.current === 'string' && body.current !== '' ? body.current : (() => { throw new HttpException(toError('bad-request', 'current invalid'), HttpStatus.BAD_REQUEST) })()
    const sessionId = body?.sessionId === undefined ? current : body.sessionId
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId === '')) {
      throw new HttpException(toError('bad-request', 'sessionId invalid'), HttpStatus.BAD_REQUEST)
    }
    try {
      const bridgeProtocol = protocolVersion(body?.protocolVersion)
      this.authorizeBridge(request, origin, bridgeProtocol)
      this.connectivity.bridgeSessionOpened(origin, sessionId as string | undefined, bridgeProtocol)
      return { opened: true, accepted: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Compatible bridge publishes a complete minimal pending snapshot. */
  @Post('bridge/pending-snapshot')
  async bridgePendingSnapshot(
    @Req() request: import('express').Request,
    @Body() body: { protocolVersion?: unknown; seamVersion?: unknown; items?: unknown },
  ): Promise<{ accepted: boolean }> {
    const origin = requireOrigin(request)
    try {
      const bridgeProtocol = protocolVersion(body?.protocolVersion)
      this.authorizeBridge(request, origin, bridgeProtocol)
      if (body?.seamVersion !== 1 || !Array.isArray(body.items) || body.items.length > 512) {
        throw new Error('pending snapshot invalid')
      }
      const seen = new Set<string>()
      const items = body.items.map((value): { sessionId: string; kind: 'approval' | 'question'; key: string } => {
        if (typeof value !== 'object' || value === null) throw new Error('pending snapshot item invalid')
        const item = value as Record<string, unknown>
        if (typeof item.sessionId !== 'string' || item.sessionId === '' || item.sessionId.length > 256
          || (item.kind !== 'approval' && item.kind !== 'question')
          || typeof item.key !== 'string' || item.key === '' || item.key.length > 512) throw new Error('pending snapshot item invalid')
        const identity = item.sessionId + '\u0000' + item.key
        if (seen.has(identity)) throw new Error('pending snapshot duplicate key')
        seen.add(identity)
        return { sessionId: item.sessionId, kind: item.kind, key: item.key }
      })
      this.connectivity.bridgePendingSnapshot(origin, items, bridgeProtocol)
      return { accepted: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Bridge plugin startup hello records the protocol and current selection. */
  @Post('bridge/hello')
  async bridgeHello(
    @Req() request: import('express').Request,
    @Body() body: { version?: unknown; protocolVersion?: unknown; current?: unknown },
  ): Promise<{ helloed: boolean; accepted: boolean }> {
    const origin = requireOrigin(request)
    const current = body?.current === null || body?.current === undefined
      ? undefined
      : typeof body.current === 'string' && body.current !== '' ? body.current : (() => { throw new HttpException(toError('bad-request', 'current invalid'), HttpStatus.BAD_REQUEST) })()
    const version = typeof body?.version === 'string' ? body.version : 'unknown'
    try {
      const bridgeProtocol = protocolVersion(body?.protocolVersion)
      this.authorizeBridge(request, origin, bridgeProtocol)
      this.connectivity.bridgeHello(origin, version, bridgeProtocol, current)
      return { helloed: true, accepted: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Register a device-side loopback port as publishable, and publish it.
   *
   * Unlike the reporting callbacks above, these two DO make the cockpit act
   * (the publish spawns an ssh forward), so they require a capability rather
   * than accepting the header-less legacy path: `authorizeBridge` returns
   * early when no header is present, which is right for a report and wrong
   * for an action. The device is resolved from `Origin`, so a caller can
   * never register or publish for a device other than its own. */
  @Post('bridge/publishable-port')
  async bridgeRegisterPublishablePort(
    @Req() request: import('express').Request,
    @Body() body: { channelId?: unknown; devicePort?: unknown; protocolVersion?: unknown },
  ): Promise<{ registered: boolean }> {
    const origin = requireOrigin(request)
    try {
      const bridgeProtocol = protocolVersion(body?.protocolVersion)
      this.requireBridgeCapability(request, origin, bridgeProtocol)
      if (typeof body?.channelId !== 'string' || typeof body?.devicePort !== 'number') {
        throw new HttpException(toError('bad-request', 'channelId and devicePort are required'), HttpStatus.BAD_REQUEST)
      }
      this.connectivity.registerPublishablePort(origin, body.channelId, body.devicePort)
      return { registered: true }
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  @Post('bridge/publish-port')
  async bridgePublishPort(
    @Req() request: import('express').Request,
    @Body() body: { channelId?: unknown; protocolVersion?: unknown },
  ): Promise<{ url: string; localPort: number }> {
    const origin = requireOrigin(request)
    try {
      const bridgeProtocol = protocolVersion(body?.protocolVersion)
      this.requireBridgeCapability(request, origin, bridgeProtocol)
      if (typeof body?.channelId !== 'string') {
        throw new HttpException(toError('bad-request', 'channelId is required'), HttpStatus.BAD_REQUEST)
      }
      return await this.connectivity.publishPort(origin, body.channelId)
    } catch (cause) {
      throw toHttp(cause)
    }
  }

  /** Capability is mandatory here: these routes cause a server-side action. */
  private requireBridgeCapability(request: import('express').Request, origin: string, protocolVersion: number): void {
    const token = request.headers[BRIDGE_CAPABILITY_HEADER]
    const capability = Array.isArray(token) ? token[0] : token
    if (capability === undefined) {
      throw new HttpException(toError('unauthorized', 'bridge capability required'), HttpStatus.UNAUTHORIZED)
    }
    this.authorizeBridge(request, origin, protocolVersion)
  }

  /** Validates the capability ONLY when the caller presented one. A request
   * with no capability header reached this method only because it already
   * satisfied TokenMiddleware's persistent-cookie requirement (the middleware
   * carve-out that lets a header-bearing request skip the cookie check does
   * not, and must not, also let a header-less request skip both checks) — so
   * it is legitimately the legacy compatibility path, not an unauthenticated
   * request, and must not be rejected here.
   *
   * Rejections are graded rather than always logged at WARN: the capability
   * and origin races this method sees are the NORMAL self-healing path (the
   * plugin re-issues and re-posts), and logging each one at WARN drowned the
   * log — 54% of a real install's lines. They are recorded at debug with full
   * structure so they stay diagnosable on demand, and only a genuine
   * self-healing failure escalates, so "green dot stopped clearing" remains
   * findable at the level meant for things a human must look at. */
  private authorizeBridge(request: import('express').Request, origin: string, protocolVersion = 1): void {
    const token = request.headers[BRIDGE_CAPABILITY_HEADER]
    const capability = Array.isArray(token) ? token[0] : token
    if (capability === undefined) return
    try {
      this.connectivity.validateBridgeCapability(origin, capability)
    } catch (cause) {
      // Logging is strictly best-effort and must never change the outcome:
      // the original rejection is rethrown untouched even if grading or the
      // logger itself misbehaves. That keeps this path safe on a reduced
      // dependency surface (partial mocks, a future refactor) as well.
      try {
        const reason = cause instanceof Error ? cause.message : String(cause)
        const deviceId = this.connectivity.resolveBridgeDeviceId(origin) ?? 'unknown'
        const graded = this.connectivity.gradeBridgeRejection(origin, reason)
        const detail = `device=${deviceId} origin=${origin} protocolVersion=${protocolVersion} reason=${reason} class=${graded.class} count=${graded.count}`
        if (graded.level === 'warn') {
          this.logger.warn(`bridge self-healing failed: bridge callbacks repeatedly rejected without any successful report — ${detail}`)
        } else {
          this.logger.debug(`bridge callback rejected: ${detail}`)
        }
      } catch {
        // Diagnostics only; the rejection below is what matters.
      }
      throw cause
    }
  }
}

function decodeDeviceId(value: string): string {
  if (typeof value !== 'string' || value === '') throw new HttpException(toError('bad-request', 'deviceId required'), HttpStatus.BAD_REQUEST)
  return value
}

function protocolVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1
}

function requireOrigin(request: import('express').Request): string {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') {
    throw new HttpException(toError('bad-request', 'origin header required'), HttpStatus.BAD_REQUEST)
  }
  return origin
}

function requireAdd(body: AddDeviceRequest): AddDeviceRequest {
  if (typeof body?.displayName !== 'string' || body.displayName === '') throw new HttpException(toError('bad-request', 'displayName required'), HttpStatus.BAD_REQUEST)
  if (body.kind !== undefined && body.kind !== 'local' && body.kind !== 'remote') throw new HttpException(toError('bad-request', 'kind must be local or remote'), HttpStatus.BAD_REQUEST)
  if (!Number.isInteger(body?.remoteDshPort) || (body?.remoteDshPort ?? 0) < 1) throw new HttpException(toError('bad-request', 'remoteDshPort must be a positive integer'), HttpStatus.BAD_REQUEST)
  if ((body.kind ?? 'remote') === 'remote' && (typeof body?.sshAlias !== 'string' || body.sshAlias === '')) throw new HttpException(toError('bad-request', 'sshAlias required for remote device'), HttpStatus.BAD_REQUEST)
  return {
    displayName: body.displayName,
    remoteDshPort: body.remoteDshPort,
    ...(body.kind === undefined ? {} : { kind: body.kind }),
    ...(body.sshAlias === undefined ? {} : { sshAlias: body.sshAlias }),
    ...(body?.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.dshLaunchUrl === undefined ? {} : { dshLaunchUrl: requireLaunchUrl(body.dshLaunchUrl) }),
    ...(body.dshAuthAutoDiscovery === undefined ? {} : { dshAuthAutoDiscovery: requireBoolean(body.dshAuthAutoDiscovery, 'dshAuthAutoDiscovery') }),
  }
}

function requireUpdate(body: UpdateDeviceRequest): UpdateDeviceRequest {
  if (typeof body !== 'object' || body === null) throw new HttpException(toError('bad-request', 'body required'), HttpStatus.BAD_REQUEST)
  const update: Record<string, unknown> = {}
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName === '') throw new HttpException(toError('bad-request', 'displayName invalid'), HttpStatus.BAD_REQUEST)
    update.displayName = body.displayName
  }
  if (body.sshAlias !== undefined) {
    if (typeof body.sshAlias !== 'string' || body.sshAlias === '') throw new HttpException(toError('bad-request', 'sshAlias invalid'), HttpStatus.BAD_REQUEST)
    update.sshAlias = body.sshAlias
  }
  if (body.remoteDshPort !== undefined) {
    if (!Number.isInteger(body.remoteDshPort) || body.remoteDshPort < 1) throw new HttpException(toError('bad-request', 'remoteDshPort invalid'), HttpStatus.BAD_REQUEST)
    update.remoteDshPort = body.remoteDshPort
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpException(toError('bad-request', 'enabled must be boolean'), HttpStatus.BAD_REQUEST)
    update.enabled = body.enabled
  }
  if (body.order !== undefined) {
    if (!Number.isInteger(body.order)) throw new HttpException(toError('bad-request', 'order must be an integer'), HttpStatus.BAD_REQUEST)
    update.order = body.order
  }
  if (body.dshLaunchUrl !== undefined) update.dshLaunchUrl = requireLaunchUrl(body.dshLaunchUrl)
  if (body.clearDshLaunchToken !== undefined) update.clearDshLaunchToken = requireBoolean(body.clearDshLaunchToken, 'clearDshLaunchToken')
  if (body.dshAuthAutoDiscovery !== undefined) update.dshAuthAutoDiscovery = requireBoolean(body.dshAuthAutoDiscovery, 'dshAuthAutoDiscovery')
  return update as UpdateDeviceRequest
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new HttpException(toError('bad-request', `${name} must be boolean`), HttpStatus.BAD_REQUEST)
  return value
}

function requireLaunchUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    throw new HttpException(toError('bad-request', 'dshLaunchUrl invalid'), HttpStatus.BAD_REQUEST)
  }
  return value
}

function toError(code: string, message: string): ApiError { return { code, message } }

function toHttp(cause: unknown): HttpException {
  // An already-shaped HttpException carries a deliberate status (e.g. 401 for
  // a missing bridge capability); re-wrapping it would silently downgrade
  // that to the generic 400 below.
  if (cause instanceof HttpException) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/unknown device/.test(message)) return new HttpException(toError('unknown-device', message), HttpStatus.NOT_FOUND)
  if (/SSH identity verification failed/.test(message)) return new HttpException(toError('ssh-identity-failed', message), HttpStatus.BAD_REQUEST)
  if (/invalid origin|matches origin/.test(message)) return new HttpException(toError('bad-request', message), HttpStatus.BAD_REQUEST)
  if (/bridge capability/.test(message)) return new HttpException(toError('bridge-capability-invalid', message), HttpStatus.BAD_REQUEST)
  return new HttpException(toError('device-command-failed', message), HttpStatus.BAD_REQUEST)
}