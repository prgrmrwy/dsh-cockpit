import { useState } from 'react'
import { isChimeEnabled, setChimeEnabled } from '../../chime.js'

export function GeneralSettings() {
  const [chime, setChime] = useState(isChimeEnabled)
  return <div className="console-content"><header className="console-detail-heading" role="presentation"><div><h2>通用</h2><p>驾驶舱的本地偏好与存储。</p></div></header>
    <section className="console-section"><h3>声音</h3><div className="console-fields"><label className="console-check"><div>提示音<p>等待决策时敲门，完成未读时叮一声。仅保存在本浏览器。</p></div><input aria-label="提示音" type="checkbox" checked={chime} onChange={e => { setChimeEnabled(e.target.checked); setChime(e.target.checked) }} /></label></div></section>
    <section className="console-section"><h3>存储</h3><div className="console-fields"><div className="console-readonly"><span>数据目录</span><span>~/.dsh-cockpit/</span></div></div><p className="console-note">设备记录保存在运行驾驶舱的这台电脑上。</p></section>
  </div>
}
