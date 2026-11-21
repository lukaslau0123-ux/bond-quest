// 桌面通知：Windows 用 PowerShell 氣泡提示，其他平台 fallback 到終端機提示音 + 日誌。
// 通知永遠不應該令流程崩潰，所以全部包在 try/catch 內。
import { spawnSync } from 'node:child_process';

function esc(s) {
  return String(s).replace(/'/g, "''").replace(/[\r\n]+/g, ' ');
}

export function notify(title, body = '') {
  // 終端機提示音，無 GUI 環境都仍然有感知
  try { process.stdout.write('\x07'); } catch { /* ignore */ }

  if (process.platform !== 'win32') return;

  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$n = New-Object System.Windows.Forms.NotifyIcon;",
    "$n.Icon = [System.Drawing.SystemIcons]::Warning;",
    "$n.Visible = $true;",
    "$n.ShowBalloonTip(6000, '" + esc(title) + "', '" + esc(body) + "', [System.Windows.Forms.ToolTipIcon]::Warning);",
    "Start-Sleep -Milliseconds 1200;",
    "$n.Dispose();",
  ].join(' ');

  try {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      timeout: 8000,
      stdio: 'ignore',
    });
  } catch {
    // 通知失敗不影響主流程
  }
}
