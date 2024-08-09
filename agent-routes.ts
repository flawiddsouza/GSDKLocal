import { writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import Docker from 'dockerode'
import type { FastifyInstance } from 'fastify'
import { Constants } from './constants'
import { createContainerRequestBodySchema, startContainerRequestBodySchema } from './types'

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const dockerDataConfigDirectory = fastify.config.dockerDataConfigDirectory
  const dockerDataGameLogsDirectory = fastify.config.dockerDataGameLogsDirectory

  fastify.post('/createContainer', async (request, reply) => {
    const validationResult = createContainerRequestBodySchema.safeParse(request.body)

    if (!validationResult.success) {
      reply.type('application/json').code(400)
      return { error: validationResult }
    }

    const body = validationResult.data

    const gsdkConfigDir = path.join(dockerDataConfigDirectory, body.port)

    await mkdir(gsdkConfigDir, { recursive: true })

    const docker = new Docker()

    const container = await docker.createContainer({
      Image: body.imageName,
      HostConfig: {
        NetworkMode: 'host',
        PortBindings: {
          [`${body.port}/tcp`]: [{ HostPort: body.port }],
        },
        Mounts: [
          {
            Target: `/data/${Constants.GAME_SERVER_CONFIG_DIRECTORY}`,
            Source: gsdkConfigDir,
            Type: 'bind',
            ReadOnly: true,
          },
          {
            Target: `/data/${Constants.GAME_SERVER_LOGS_DIRECTORY}`,
            Source: dockerDataGameLogsDirectory,
            Type: 'bind',
          },
        ],
      },
      Env: [`GSDK_CONFIG_FILE=/data/${Constants.GAME_SERVER_CONFIG_DIRECTORY}/${Constants.GSDK_CONFIG_FILENAME}`],
    })

    reply.type('application/json').code(200)
    return {
      containerId: container.id,
    }
  })

  fastify.post('/startContainer/:containerId', async (request, reply) => {
    const containerId = (request.params as { containerId: string }).containerId

    const validationResult = startContainerRequestBodySchema.safeParse(request.body)

    if (!validationResult.success) {
      reply.type('application/json').code(400)
      return { error: validationResult }
    }

    const body = validationResult.data

    const docker = new Docker()

    const container = docker.getContainer(containerId)

    const gsdkConfigDir = path.join(dockerDataConfigDirectory, body.port)

    const gsdkConfigPath = path.join(gsdkConfigDir, Constants.GSDK_CONFIG_FILENAME)

    writeFileSync(
      gsdkConfigPath,
      JSON.stringify(
        {
          heartbeatEndpoint: body.heartbeatEndpoint,
          sessionHostId: body.serverId,
          logFolder: `/data/${Constants.GAME_SERVER_LOGS_DIRECTORY}/${body.serverId}/`,
        },
        null,
        4,
      ),
    )

    await container.start()

    reply.type('application/json').code(200)
    return {
      publicIp: process.env.PUBLIC_IP,
    }
  })
}
