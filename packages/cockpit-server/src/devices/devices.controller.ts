import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common'
import type { AddDeviceRequest, ApiError, DeviceStatusFacts, UpdateDeviceRequest } from '@dsh-cockpit/shared'
import { ConnectivityService } from '../connectivity/connectivity.service.js'
import { DeviceEventsService } from '../connectivity/device-events.service.js'

@Controller('api')
export class DevicesController {
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
}

function decodeDeviceId(value: string): string {
  if (typeof value !== 'string' || value === '') throw new HttpException(toError('bad-request', 'deviceId required'), HttpStatus.BAD_REQUEST)
  return value
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
  return update as UpdateDeviceRequest
}

function toError(code: string, message: string): ApiError { return { code, message } }

function toHttp(cause: unknown): HttpException {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/unknown device/.test(message)) return new HttpException(toError('unknown-device', message), HttpStatus.NOT_FOUND)
  if (/SSH identity verification failed/.test(message)) return new HttpException(toError('ssh-identity-failed', message), HttpStatus.BAD_REQUEST)
  return new HttpException(toError('device-command-failed', message), HttpStatus.BAD_REQUEST)
}