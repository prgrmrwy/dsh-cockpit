import type { DeviceStatusFacts } from '@dsh-cockpit/shared'

export function connectionRoute(device: DeviceStatusFacts) {
  const nodes = device.kind === 'local'
    ? ['此电脑', `127.0.0.1:${device.remoteDshPort}`]
    : ['此电脑', `SSH ${device.sshAlias ?? '未配置'}`, device.endpoint ? new URL(device.endpoint).host : '本地回环', `DSH :${device.remoteDshPort}`]
  const failed = device.state === 'SSH_UNREACHABLE' ? 1 : device.state === 'TUNNEL_ERROR' ? 2
    : ['DSH_UNAVAILABLE', 'NON_DSH_SERVICE', 'INCOMPATIBLE'].includes(device.state) ? nodes.length - 1 : -1
  return { nodes, failed: Math.min(failed, nodes.length - 1) }
}

export function ConnectionRoute({ device }: { device: DeviceStatusFacts }) {
  const { nodes, failed } = connectionRoute(device)
  return <ol className="connection-route" aria-label="连接路径" data-state={device.state}>
    {nodes.map((node, index) => <li key={index} data-failed={index === failed || undefined}>
      <span className="route-point" aria-hidden="true" /><span>{node}</span>
    </li>)}
  </ol>
}
