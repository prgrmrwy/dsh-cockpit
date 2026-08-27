import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Put, Query } from '@nestjs/common'
import type { AddDeviceRequest, ApiError, DeviceStatusFacts, RemoveDeviceRequest, UpdateDeviceRequest } from '@dsh-cockpit/shared'
import { ConnectivityService } from '../connectivity/connectivity.service.js'

@Controller('api')
export class DevicesController {
  constructor(private readonly connectivity: ConnectivityService) {}

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
}

function decodeDeviceId(value: string): string {
  if (typeof value !== 'string' || value === '') throw new HttpException(toError('bad-request', 'deviceId required'), HttpStatus.BAD_REQUEST)
  return value
}

function requireAdd(body: AddDeviceRequest): AddDeviceRequest {
  if (typeof body?.displayName !== 'string' || body.displayName === '') throw new HttpException(toError('bad-request', 'displayName required'), HttpStatus.BAD_REQUEST)
  if (typeof body?.sshAlias !== 'string' || body.sshAlias === '') throw new HttpException(toError('bad-request', 'sshAlias required'), HttpStatus.BAD_REQUEST)
  if (!Number.isInteger(body?.remoteDshPort) || (body?.remoteDshPort ?? 0) < 1) throw new HttpException(toError('bad-request', 'remoteDshPort must be a positive integer'), HttpStatus.BAD_REQUEST)
  return {
    displayName: body.displayName,
    sshAlias: body.sshAlias,
    remoteDshPort: body.remoteDshPort,
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