import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mutex } from 'async-mutex'
import Docker from 'dockerode'
import dotenv from 'dotenv'
import Fastify from 'fastify'
import { publicIpv4 } from 'public-ip'
import { Constants } from './constants'
import * as db from './db'
import type { GameServerInstance } from './schema'
import {
  type EnvToLoggerType,
  GameOperation,
  type HeartbeatRequestBody,
  type HeartbeatResponse,
  type PlayFabRequestMultiplayer,
  type RequestMultiplayerServerRequestBody,
  type SafeParseValidationErrorResponse,
  type ValidationErrorResponse,
  heartbeatRequestBodySchema,
  requestMultiplayerServerRequestBodySchema,
} from './types'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dockerDataDirectory = path.join(__dirname, 'docker-data')

const envToLogger: EnvToLoggerType = {
  development: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  production: true,
  test: false,
}

const fastify = Fastify({
  logger: envToLogger[process.env.NODE_ENV || 'development'],
})

if (!existsSync(dockerDataDirectory)) {
  mkdirSync(dockerDataDirectory, { recursive: true })
}

if (!process.env.PUBLIC_IP) {
  const publicIp = await publicIpv4()
  process.env.PUBLIC_IP = publicIp
}

console.log('Public IP:', process.env.PUBLIC_IP)

// Create the mutex
const portMutex = new Mutex()

fastify.post('/requestMultiplayerServer', async (request, reply): Promise<PlayFabRequestMultiplayer.Response | SafeParseValidationErrorResponse<RequestMultiplayerServerRequestBody> | ValidationErrorResponse> => {
  // Wait for the lock to be available
  const release = await portMutex.acquire()

  try {
    const validationResult = requestMultiplayerServerRequestBodySchema.safeParse(request.body)

    if (!validationResult.success) {
      reply.type('application/json').code(400)
      return { error: validationResult }
    }

    const body: RequestMultiplayerServerRequestBody = validationResult.data

    const build = await db.getBuild(body.BuildId)

    if (!build) {
      reply.type('application/json').code(400)
      return { error: 'Build not found' }
    }

    const port = await db.getPort()

    if (!port) {
      reply.type('application/json').code(400)
      return { error: 'No ports available' }
    }

    const gameServerInstance: GameServerInstance = {
      serverId: '',
      buildId: body.BuildId,
      sessionConfig: {
        sessionId: body.SessionId,
        sessionCookie: body.SessionCookie,
        metadata: { gamePort: port },
      },
      port: port,
    }

    const docker = new Docker()

    const gsdkConfigPath = path.join(dockerDataDirectory, Constants.GSDK_CONFIG_FILENAME)

    const container = await docker.createContainer({
      Image: build.imageName,
      HostConfig: {
        NetworkMode: 'host',
        PortBindings: {
          [`${port}/tcp`]: [{ HostPort: port }],
        },
        Mounts: [
          {
            Target: '/data',
            Source: dockerDataDirectory,
            Type: 'bind',
          },
        ],
      },
      Env: [`GSDK_CONFIG_FILE=/data/${Constants.GSDK_CONFIG_FILENAME}`],
    })

    gameServerInstance.serverId = container.id

    const publicIp = process.env.PUBLIC_IP

    writeFileSync(
      gsdkConfigPath,
      JSON.stringify(
        {
          heartbeatEndpoint: `${publicIp}:9006`,
          sessionHostId: gameServerInstance.serverId,
          logFolder: `/data/GameLogs/${gameServerInstance.serverId}/`,
        },
        null,
        4,
      ),
    )

    await db.createGameServerInstance(gameServerInstance)

    await container.start()

    reply.type('application/json').code(200)
    return {
      code: 200,
      data: {
        ServerId: gameServerInstance.serverId,
        IPV4Address: publicIp,
        Ports: [
          {
            Num: Number(port),
          },
        ],
        LastStateTransitionTime: new Date(),
      },
    }
  } catch (err) {
    reply.type('application/json').code(500)
    return { error: 'Internal server error' }
  } finally {
    // Release the lock
    release()
  }
})

fastify.patch('/v1/sessionHosts/:serverId', async (request, reply) => {
  const serverId = (request.params as { serverId: string }).serverId

  const gameServerInstance = await db.getGameServerInstance(serverId)

  if (!gameServerInstance) {
    reply.type('application/json').code(404)
    return { error: 'Server not found' }
  }

  const validationResult = heartbeatRequestBodySchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    console.log(validationResult.error)
    return { error: validationResult }
  }

  const body: HeartbeatRequestBody = validationResult.data

  console.log(body)

  const heartbeatResponse: HeartbeatResponse = {
    sessionConfig: gameServerInstance.sessionConfig,
    operation: GameOperation.Active,
  }

  reply.type('application/json').code(200)
  return heartbeatResponse
})

fastify.listen({ host: '0.0.0.0', port: 9006 }, (err, address) => {
  if (err) {
    throw err
  }
})
