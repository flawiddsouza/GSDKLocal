import type { PinoLoggerOptions } from 'fastify/types/logger'
import { type SafeParseError, z } from 'zod'

export interface SessionConfig {
  sessionId: string
  sessionCookie: string
  initialPlayers?: string[]
  metadata: { [key: string]: string }
}

export enum GameState {
  Invalid = 'Invalid',
  Initializing = 'Initializing',
  StandingBy = 'StandingBy',
  Active = 'Active',
  Terminating = 'Terminating',
  Terminated = 'Terminated',
  Quarentined = 'Quarentined',
}

export enum GameOperation {
  Invalid = 0,
  Continue = 1,
  Active = 2,
  Terminate = 3,
}

interface MaintenanceSchedule {
  documentIncarnation: string
  events: MaintenanceEvent[]
}

interface MaintenanceEvent {
  eventId: string
  eventType: string
  resourceType: string
  resources: string[]
  eventStatus: string
  notBefore?: Date
  description: string
  eventSource: string
  durationInSeconds: number
}

export type HeartbeatResponse = {
  sessionConfig?: SessionConfig
  nextScheduledMaintenanceUtc?: string
  maintenanceSchedule?: MaintenanceSchedule
  operation: GameOperation
}

export const requestMultiplayerServerRequestBodySchema = z.object({
  PreferredRegions: z.array(z.string()),
  SessionId: z.string().uuid(),
  BuildId: z.string(),
  SessionCookie: z.string(),
})

export type RequestMultiplayerServerRequestBody = z.infer<typeof requestMultiplayerServerRequestBodySchema>

export const heartbeatRequestBodySchema = z.object({
  CurrentGameState: z.nativeEnum(GameState),
  CurrentGameHealth: z.string(),
  CurrentPlayers: z.array(z.any()),
})

export type HeartbeatRequestBody = z.infer<typeof heartbeatRequestBodySchema>

export namespace PlayFabRequestMultiplayer {
  export interface Response {
    code: number
    status?: string
    data?: ResponseData
  }

  interface ConnectedPlayer {
    PlayerId: string
  }

  interface ResponseData {
    SessionId?: string
    ServerId?: string
    VmId?: string
    IPV4Address?: string
    FQDN?: string
    PublicIPV4Addresses?: PublicIPV4Address[]
    Ports?: Port[]
    Region?: string
    State?: string
    ConnectedPlayers?: ConnectedPlayer[]
    LastStateTransitionTime: Date
    BuildId?: string
  }

  interface Port {
    Name?: string
    Num: number
    Protocol?: string
  }

  interface PublicIPV4Address {
    IpAddress?: string
    FQDN?: string
    RoutingType?: string
  }
}

export interface SafeParseValidationErrorResponse<T> {
  error: SafeParseError<T>
}

export interface ValidationErrorResponse {
  error: string
}

export type EnvToLoggerType = Record<string, PinoLoggerOptions>
