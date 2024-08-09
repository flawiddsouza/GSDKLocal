import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mutex } from 'async-mutex'
import dotenv from 'dotenv'
import Fastify from 'fastify'
import { publicIpv4 } from 'public-ip'
import * as agentApi from './agent-api'
import { agentRoutes } from './agent-routes'
import { Constants } from './constants'
import * as db from './db'
import { logger } from './logger'
import { agentCreateSchema, agentUpdateSchema, buildCreateSchema, buildUpdateSchema } from './schema'
import type { AgentUpdate, BuildUpdate, GameServerInstance, GameServerInstanceCreateOrUpdate } from './schema'
import { GameOperation, GameState, heartbeatRequestBodySchema, requestMultiplayerServerRequestBodySchema } from './types'
import type { HeartbeatRequestBody, HeartbeatResponse, PlayFabRequestMultiplayer, RequestMultiplayerServerRequestBody, SafeParseValidationErrorResponse, ValidationErrorResponse } from './types'

dotenv.config()

const applicationPort = Number(process.env.PORT) || 9006
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dockerDataDirectory = path.join(__dirname, 'docker-data')
const dockerDataConfigDirectory = path.join(dockerDataDirectory, Constants.GAME_SERVER_CONFIG_DIRECTORY)
const dockerDataGameLogsDirectory = path.join(dockerDataDirectory, Constants.GAME_SERVER_LOGS_DIRECTORY)
const portMutex = new Mutex()
const gameServerInstanceHeartbeatTracker = new Map<string, Date>()
const gameServerInstanceInitiateTermination = new Set<string>()

const fastify = Fastify({
  logger,
})

fastify.decorate('config', {
  dockerDataConfigDirectory,
  dockerDataGameLogsDirectory,
})

if (!existsSync(dockerDataConfigDirectory)) {
  mkdirSync(dockerDataConfigDirectory, { recursive: true })
}

if (!existsSync(dockerDataGameLogsDirectory)) {
  mkdirSync(dockerDataGameLogsDirectory, { recursive: true })
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
  const validationResult = buildCreateSchema.safeParse(request.body)

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

fastify.put('/build/:buildId', async (request, reply): Promise<{ success: true } | SafeParseValidationErrorResponse<BuildUpdate> | ValidationErrorResponse> => {
  const buildId = (request.params as { buildId: string }).buildId

  const validationResult = buildUpdateSchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body = validationResult.data

  const build = await db.getBuild(buildId)

  if (!build) {
    reply.type('application/json').code(404)
    return { error: 'Build not found' }
  }

  if (Object.keys(body).length === 0) {
    reply.type('application/json').code(400)
    return { error: 'No fields to update' }
  }

  await db.updateBuild(buildId, body)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.delete('/build/:buildId', async (request, reply) => {
  const buildId = (request.params as { buildId: string }).buildId

  const build = await db.getBuild(buildId)

  if (!build) {
    reply.type('application/json').code(404)
    return { error: 'Build not found' }
  }

  await db.deleteBuild(buildId)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.get('/agents', async () => {
  return db.getAgents()
})

fastify.post('/agent', async (request, reply) => {
  const validationResult = agentCreateSchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body = validationResult.data

  await db.createAgent(body)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.put('/agent/:id', async (request, reply): Promise<{ success: true } | SafeParseValidationErrorResponse<AgentUpdate> | ValidationErrorResponse> => {
  const id = (request.params as { id: number }).id

  const validationResult = agentUpdateSchema.safeParse(request.body)

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body = validationResult.data

  const agent = await db.getAgent(id)

  if (!agent) {
    reply.type('application/json').code(404)
    return { error: 'Agent not found' }
  }

  if (Object.keys(body).length === 0) {
    reply.type('application/json').code(400)
    return { error: 'No fields to update' }
  }

  await db.updateAgent(id, body)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.delete('/agent/:id', async (request, reply) => {
  const id = (request.params as { id: number }).id

  const agent = await db.getAgent(id)

  if (!agent) {
    reply.type('application/json').code(404)
    return { error: 'Agent not found' }
  }

  await db.deleteAgent(id)

  reply.type('application/json').code(200)
  return {
    success: true,
  }
})

fastify.register(agentRoutes, { prefix: '/agent' })

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

    const agent = await db.getAvailableAgent()

    if (!agent) {
      reply.type('application/json').code(400)
      return { error: 'No agents available' }
    }

    const port = await db.getPort(agent.id)

    if (!port) {
      reply.type('application/json').code(400)
      return { error: 'No ports available' }
    }

    const gameServerInstance: GameServerInstanceCreateOrUpdate = {
      agentId: agent.id,
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

    const createContainerResponse = await agentApi.createContainer(agent, build.imageName, port)

    if (!createContainerResponse.success) {
      reply.type('application/json').code(500)
      return { error: 'Failed to create container' }
    }

    const containerId = createContainerResponse.containerId

    gameServerInstance.serverId = containerId

    await db.createGameServerInstance(gameServerInstance)

    const startContainerResponse = await agentApi.startContainer(agent, containerId, `${process.env.PUBLIC_IP}:${applicationPort}`, gameServerInstance.serverId, port)

    if (!startContainerResponse.success) {
      reply.type('application/json').code(500)
      return { error: 'Failed to start container' }
    }

    const publicIp = startContainerResponse.publicIp

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

function initiateGameServerInstanceTerminationIfActiveForMoreThan24Hours(gameServerInstance: GameServerInstance) {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const now = new Date()

  if (gameServerInstanceInitiateTermination.has(gameServerInstance.serverId) === false) {
    const gameServerInstanceCreatedTime = new Date(gameServerInstance.createdAt as string)
    const activeTime = now.getTime() - gameServerInstanceCreatedTime.getTime()

    if (activeTime > TWENTY_FOUR_HOURS) {
      logger.info(`Game server instance active for more than 24 hours, initiating termination: ${gameServerInstance.serverId}`)
      gameServerInstanceInitiateTermination.add(gameServerInstance.serverId)
    }
  }
}

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

  initiateGameServerInstanceTerminationIfActiveForMoreThan24Hours(gameServerInstance)

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

fastify.listen({ host: '0.0.0.0', port: applicationPort }, (err, address) => {
  if (err) {
    throw err
  }
})
