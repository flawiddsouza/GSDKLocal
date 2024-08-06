import type { Agent } from './schema'

export async function createContainer(agent: Agent, imageName: string, port: string): Promise<{ success: false } | { success: true; containerId: string }> {
  try {
    const response = await fetch(`${agent.host}/createContainer`, {
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
    const response = await fetch(`${agent.host}/startContainer/${containerId}`, {
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
