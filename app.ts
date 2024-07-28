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
import { logger } from './logger'
import { type GameServerInstanceCreateOrUpdate, buildCreateOrUpdateSchema } from './schema'
import { GameOperation, GameState, heartbeatRequestBodySchema, requestMultiplayerServerRequestBodySchema } from './types'
import type { HeartbeatRequestBody, HeartbeatResponse, PlayFabRequestMultiplayer, RequestMultiplayerServerRequestBody, SafeParseValidationErrorResponse, ValidationErrorResponse } from './types'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dockerDataDirectory = path.join(__dirname, 'docker-data')
const portMutex = new Mutex()
const gameServerInstanceHeartbeatTracker = new Map<string, Date>()
const gameServerInstanceInitiateTermination = new Set<string>()

const fastify = Fastify({
  logger,
})

if (!existsSync(dockerDataDirectory)) {
  mkdirSync(dockerDataDirectory, { recursive: true })
}

if (!process.env.PUBLIC_IP) {
  const publicIp = await publicIpv4()
  process.env.PUBLIC_IP = publicIp
}

logger.info(`Public IP: ${process.env.PUBLIC_IP}`)

fastify.get('/builds', async () => {
  return db.getBuilds()
})

fastify.post('/build', async (request, reply): Promise<{ success: true } | SafeParseValidationErrorResponse<GameServerInstanceCreateOrUpdate> | ValidationErrorResponse> => {
  const validationResult = buildCreateOrUpdateSchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body = validationResult.data

  await db.createBuild(body)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.put('/build/:buildId', async (request, reply): Promise<{ success: true } | SafeParseValidationErrorResponse<GameServerInstanceCreateOrUpdate> | ValidationErrorResponse> => {
  const buildId = (request.params as { buildId: string }).buildId

  const validationResult = buildCreateOrUpdateSchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body = validationResult.data

  await db.updateBuild(buildId, body)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.delete('/build/:buildId', async (request, reply) => {
  const buildId = (request.params as { buildId: string }).buildId

  await db.deleteBuild(buildId)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

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

    const gameServerInstance: GameServerInstanceCreateOrUpdate = {
      serverId: '',
      buildId: body.BuildId,
      port: port,
      sessionConfig: {
        sessionId: body.SessionId,
        sessionCookie: body.SessionCookie,
        metadata: { gamePort: port },
      },
      status: GameState.StandingBy,
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

fastify.get('/gameServerInstances', async () => {
  return db.getUnterminatedGameServerInstances()
})

fastify.post('/terminateGameServerInstance/:serverId', async (request, reply) => {
  const serverId = (request.params as { serverId: string }).serverId

  const gameServerInstance = await db.getGameServerInstance(serverId)

  if (!gameServerInstance) {
    reply.type('application/json').code(404)
    return { error: 'Server not found' }
  }

  if (gameServerInstance.status === GameState.Terminated) {
    reply.type('application/json').code(400)
    return { error: 'Server already terminated' }
  }

  gameServerInstanceInitiateTermination.add(gameServerInstance.serverId)

  reply.type('application/json').code(200)
  return {
    success: true,
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
    request.log.info(validationResult.error)
    return { error: validationResult }
  }

  const body: HeartbeatRequestBody = validationResult.data

  request.log.info(body)

  const heartbeatResponse: HeartbeatResponse = {
    operation: GameOperation.Invalid,
  }

  if (body.CurrentGameState === GameState.StandingBy) {
    heartbeatResponse.operation = GameOperation.Active
    heartbeatResponse.sessionConfig = gameServerInstance.sessionConfig
  }

  if (body.CurrentGameState === GameState.Active) {
    if (gameServerInstance.status !== GameState.Active) {
      await db.updateGameServerInstance(gameServerInstance.serverId, {
        status: GameState.Active,
      })
    }
    heartbeatResponse.operation = GameOperation.Continue
  }

  if (body.CurrentGameState === GameState.Terminating) {
    heartbeatResponse.operation = GameOperation.Continue
  }

  if (gameServerInstanceInitiateTermination.has(gameServerInstance.serverId)) {
    gameServerInstanceInitiateTermination.delete(gameServerInstance.serverId)
    heartbeatResponse.operation = GameOperation.Terminate
  }

  gameServerInstanceHeartbeatTracker.set(serverId, new Date())

  reply.type('application/json').code(200)
  return heartbeatResponse
})

async function checkHeartbeats() {
  logger.info('Checking heartbeats')

  const THIRTY_SECONDS = 30 * 1000
  const now = new Date()

  const gameServerInstances = await db.getUnterminatedGameServerInstances()

  logger.info(`Game server instances: ${gameServerInstances.length}`)

  for (const gameServerInstance of gameServerInstances) {
    if (!gameServerInstanceHeartbeatTracker.has(gameServerInstance.serverId)) {
      gameServerInstanceHeartbeatTracker.set(gameServerInstance.serverId, now)
    }
    const lastHeartbeat = gameServerInstanceHeartbeatTracker.get(gameServerInstance.serverId)

    if (!lastHeartbeat) {
      throw new Error('lastHeartbeat is undefined, this should not happen')
    }

    if (now.getTime() - lastHeartbeat.getTime() > THIRTY_SECONDS) {
      await db.updateGameServerInstance(gameServerInstance.serverId, { status: GameState.Terminated })
      gameServerInstanceHeartbeatTracker.delete(gameServerInstance.serverId)
      logger.info(`Terminated game server instance: ${gameServerInstance.serverId}`)
    }
  }

  setTimeout(checkHeartbeats, 1000)
}

setTimeout(checkHeartbeats, 1000)

fastify.listen({ host: '0.0.0.0', port: 9006 }, (err, address) => {
  if (err) {
    throw err
  }
})
