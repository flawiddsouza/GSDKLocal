import type { Agent } from './schema'

export async function createContainer(agent: Agent, imageName: string, port: string): Promise<{ success: false } | { success: true; containerId: string }> {
  try {
    const response = await fetch(`${agent.host}/agent/createContainer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageName, port }),
    })

    const { containerId } = await response.json()

    return {
      success: true,
      containerId,
    }
  } catch (error) {
    console.error(error)
    return {
      success: false,
    }
  }
}

export async function startContainer(agent: Agent, containerId: string, heartbeatEndpoint: string, serverId: string, port: string): Promise<{ success: false } | { success: true; publicIp: string }> {
  try {
    const response = await fetch(`${agent.host}/agent/startContainer/${containerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ heartbeatEndpoint, serverId, port }),
    })

    const { publicIp } = await response.json()

    return {
      success: true,
      publicIp,
    }
  } catch (error) {
    console.error(error)
    return {
      success: false,
    }
  }
}

export async function isPortAvailable(agent: Agent, port: number): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${agent.host}/agent/isPortAvailable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ port }),
    })

    const { isPortAvailable }: { isPortAvailable: boolean } = await response.json()

    return {
      success: isPortAvailable,
    }
  } catch (error) {
    console.error(error)
    return {
      success: false,
    }
  }
}
