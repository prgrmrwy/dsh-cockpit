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
  async workbenchLaunch(@Param('deviceId') deviceId: string): Promise<{ url: string }> {
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

  /** Validates the capability ONLY when the caller presented one. A request
   * with no capability header reached this method only because it already
   * satisfied TokenMiddleware's persistent-cookie requirement (the middleware
   * carve-out that lets a header-bearing request skip the cookie check does
   * not, and must not, also let a header-less request skip both checks) — so
   * it is legitimately the legacy compatibility path, not an unauthenticated
   * request, and must not be rejected here. Rejections are logged
   * structurally (device/origin/protocol/reason) so "green dot stopped
   * clearing" is diagnosable from the server log. */
  private authorizeBridge(request: import('express').Request, origin: string, protocolVersion = 1): void {
    const token = request.headers[BRIDGE_CAPABILITY_HEADER]
    const capability = Array.isArray(token) ? token[0] : token
    if (capability === undefined) return
    try {
      this.connectivity.validateBridgeCapability(origin, capability)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      const deviceId = this.connectivity.resolveBridgeDeviceId(origin)
      this.logger.warn(`bridge callback rejected: device=${deviceId ?? 'unknown'} origin=${origin} protocolVersion=${protocolVersion} reason=${reason}`)
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
  if (body.clearDshLaunchToken !== undefined) {
    if (typeof body.clearDshLaunchToken !== 'boolean') throw new HttpException(toError('bad-request', 'clearDshLaunchToken must be boolean'), HttpStatus.BAD_REQUEST)
    update.clearDshLaunchToken = body.clearDshLaunchToken
  }
  return update as UpdateDeviceRequest
}

function requireLaunchUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    throw new HttpException(toError('bad-request', 'dshLaunchUrl invalid'), HttpStatus.BAD_REQUEST)
  }
  return value
}

function toError(code: string, message: string): ApiError { return { code, message } }

function toHttp(cause: unknown): HttpException {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/unknown device/.test(message)) return new HttpException(toError('unknown-device', message), HttpStatus.NOT_FOUND)
  if (/SSH identity verification failed/.test(message)) return new HttpException(toError('ssh-identity-failed', message), HttpStatus.BAD_REQUEST)
  if (/invalid origin|matches origin/.test(message)) return new HttpException(toError('bad-request', message), HttpStatus.BAD_REQUEST)
  if (/bridge capability/.test(message)) return new HttpException(toError('bridge-capability-invalid', message), HttpStatus.BAD_REQUEST)
  return new HttpException(toError('device-command-failed', message), HttpStatus.BAD_REQUEST)
}