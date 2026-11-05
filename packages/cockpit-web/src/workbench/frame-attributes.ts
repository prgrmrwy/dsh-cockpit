/** iframe attributes shared by the device workbench and forward tabs, so the
 * two frames cannot drift apart (change forward-workbench-tab D3). */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'
export const FRAME_ALLOW = 'clipboard-read; clipboard-write; microphone'
