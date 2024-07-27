import {
  GameServerInstance,
  GameOperation,
  HeartbeatResponse,
  requestMultiplayerServerRequestBodySchema,
  RequestMultiplayerServerRequestBody,
  heartbeatRequestBodySchema,
  HeartbeatRequestBody,
  PlayFabRequestMultiplayer,
  ValidationErrorResponse,
} from './types';
import Fastify from 'fastify';
import Docker from 'dockerode';
import { publicIpv4 } from 'public-ip';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { Constants } from './constants';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gameServerInstances: GameServerInstance[] = [];

const envToLogger: { [key: string]: any } = {
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
});

const startPort = 5000;
const endPort = 5100;

const dataDirectory = path.join(__dirname, 'data')

if (!existsSync(dataDirectory)) {
  mkdirSync(dataDirectory, { recursive: true });
}

function getPort(): string {
  const usedPorts = gameServerInstances.map(gameServerInstance => gameServerInstance.port);

  for (let port = startPort; port <= endPort; port++) {
    if (!usedPorts.includes(port.toString())) {
      return port.toString();
    }
  }

  throw new Error('No available ports');
}

fastify.post('/requestMultiplayerServer', async (request, reply): Promise<PlayFabRequestMultiplayer.Response |ValidationErrorResponse<RequestMultiplayerServerRequestBody>> => {
  const validationResult = requestMultiplayerServerRequestBodySchema.safeParse(request.body);

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    return { error: validationResult }
  }

  const body: RequestMultiplayerServerRequestBody = validationResult.data;

  const port = getPort();

  const gameServerInstance: GameServerInstance = {
    serverId: '',
    sessionConfig: {
      sessionId: body.SessionId,
      sessionCookie: body.SessionCookie,
      metadata: { gamePort: port }
    },
    port: port,
  };

  gameServerInstances.push(gameServerInstance);

  const docker = new Docker();

  const gsdkConfigPath = path.join(dataDirectory, Constants.GSDK_CONFIG_FILENAME);

  const container = await docker.createContainer({
    Image: 'docker.io/library/zodiac-poker-game:test',
    HostConfig: {
      NetworkMode: 'host',
      PortBindings: {
        [`${port}/tcp`]: [{ HostPort: port }]
      },
      Mounts: [
        {
          Target: '/data',
          Source: dataDirectory,
          Type: 'bind',
        },
      ],
    },
    Env: [
      `GSDK_CONFIG_FILE=/data/${Constants.GSDK_CONFIG_FILENAME}`,
    ],
  });

  gameServerInstance.serverId = container.id;

  // const publicIp = await publicIpv4();
  const publicIp = '127.0.0.1';

  writeFileSync(gsdkConfigPath, JSON.stringify({
    heartbeatEndpoint: `${publicIp}:9006`,
    sessionHostId: gameServerInstance.serverId,
    logFolder: `/data/GameLogs/${gameServerInstance.serverId}/`,
  }, null, 4));

  await container.start();

  reply.type('application/json').code(200)
  return {
    code: 200,
    data: {
      ServerId: gameServerInstance.serverId,
      IPV4Address: publicIp,
      Ports: [{
        Num: Number(port),
      }],
      LastStateTransitionTime: new Date(),
    }
  };
});

fastify.patch('/v1/sessionHosts/:serverId', async (request, reply) => {
  const serverId = (request.params as { serverId: string }).serverId;

  const gameServerInstance = gameServerInstances.find(gameServerInstance => gameServerInstance.serverId === serverId);

  if (!gameServerInstance) {
    reply.type('application/json').code(404)
    return { error: 'Server not found' }
  }

  const validationResult = heartbeatRequestBodySchema.safeParse(request.body);

  if (!validationResult.success) {
    reply.type('application/json').code(400)
    console.log(validationResult.error);
    return { error: validationResult }
  }

  const body: HeartbeatRequestBody = validationResult.data;

  console.log(body);

  const heartbeatResponse: HeartbeatResponse = {
    sessionConfig: gameServerInstance.sessionConfig,
    operation: GameOperation.Active
  };

  reply.type('application/json').code(200)
  return heartbeatResponse;
});

fastify.listen({ host: '0.0.0.0', port: 9006 }, (err, address) => {
  if (err) {
    throw err;
  }
});
