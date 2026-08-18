# DeepSeek Harness 工作区备份 / 恢复 / 更新工具
# 由 备份恢复DeepSeek-Harness.bat 调用；也可命令行直用（自动化测试）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File backup-restore.ps1 -Action backup -ZipPath <路径>
#   -Action: backup（打包）| update（合并进既有备份）| restore（还原）
#   -ZipPath: 直传路径则跳过文件对话框（批处理/自动化用）
param(
  [Parameter(Mandatory = $true)][ValidateSet('backup', 'update', 'restore')][string]$Action,
  [string]$ZipPath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sessionsDir = Join-Path $root 'dsh-home\sessions'
if (-not (Test-Path $sessionsDir)) { New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null }

Add-Type -AssemblyName System.Windows.Forms | Out-Null

function Show-OpenDialog([string]$Title) {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = $Title
  $dlg.Filter = 'Zip 备份 (*.zip)|*.zip|所有文件 (*.*)|*.*'
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.FileName }
  return ''
}

function Show-SaveDialog([string]$Title, [string]$FileName) {
  $dlg = New-Object System.Windows.Forms.SaveFileDialog
  $dlg.Title = $Title
  $dlg.Filter = 'Zip 备份 (*.zip)|*.zip'
  $dlg.FileName = $FileName
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.FileName }
  return ''
}

function Get-FileCount([string]$dir) {
  return (Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
}

switch ($Action) {
  'backup' {
    $zip = $ZipPath
    if (-not $zip) {
      $zip = Show-SaveDialog '选择备份文件保存位置' ('dsh-sessions-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
      if (-not $zip) { Write-Host '[取消] 未选择保存位置'; exit 0 }
    }
    Compress-Archive -Path (Join-Path $sessionsDir '*') -DestinationPath $zip -Force
    Write-Host ('[完成] 已备份 {0} 个文件 → {1}' -f (Get-FileCount $sessionsDir), $zip)
  }
  'update' {
    $zip = $ZipPath
    if (-not $zip) {
      $zip = Show-OpenDialog '选择要更新的既有备份 zip'
      if (-not $zip) { Write-Host '[取消] 未选择备份'; exit 0 }
    }
    if (-not (Test-Path $zip)) { Write-Host "[错误] 备份文件不存在: $zip"; exit 1 }
    Compress-Archive -Path (Join-Path $sessionsDir '*') -DestinationPath $zip -Update
    Write-Host "[完成] 当前对话存档已合并进 → $zip"
  }
  'restore' {
    $zip = $ZipPath
    if (-not $zip) {
      $zip = Show-OpenDialog '选择要恢复的备份 zip'
      if (-not $zip) { Write-Host '[取消] 未选择备份'; exit 0 }
    }
    if (-not (Test-Path $zip)) { Write-Host "[错误] 备份文件不存在: $zip"; exit 1 }
    # 现有会话先改名留底（可回退）
    if (Test-Path $sessionsDir) {
      $bak = $sessionsDir + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
      Rename-Item -Path $sessionsDir -NewName (Split-Path -Leaf $bak)
      Write-Host ('[提示] 当前会话已留底: {0}' -f (Split-Path -Leaf $bak))
    }
    Expand-Archive -Path $zip -DestinationPath $sessionsDir -Force
    Write-Host ('[完成] 已恢复 {0} 个文件，来源 → {1}' -f (Get-FileCount $sessionsDir), $zip)
  }
}
