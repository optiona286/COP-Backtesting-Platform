$ErrorActionPreference = 'Stop'
try {
    $env:R2_ENDPOINT = Read-Host 'S3 Endpoint (press Enter for the current account default)'
    $env:R2_ACCESS_KEY_ID = Read-Host 'Access Key ID'
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $r2Form = New-Object System.Windows.Forms.Form
    $r2Form.Text = 'R2 Secret Access Key'
    $r2Form.ClientSize = New-Object System.Drawing.Size(530, 155)
    $r2Form.StartPosition = 'CenterScreen'
    $r2Form.TopMost = $true
    $r2Form.FormBorderStyle = 'FixedDialog'
    $r2Form.MaximizeBox = $false
    $r2Label = New-Object System.Windows.Forms.Label
    $r2Label.Text = 'Paste Secret Access Key with Ctrl+V (not API Token).'
    $r2Label.SetBounds(15, 15, 500, 25)
    $r2Box = New-Object System.Windows.Forms.TextBox
    $r2Box.UseSystemPasswordChar = $true
    $r2Box.SetBounds(15, 45, 500, 28)
    $r2Count = New-Object System.Windows.Forms.Label
    $r2Count.SetBounds(15, 80, 340, 25)
    $r2Count.Text = '0 / 64 characters'
    $r2Button = New-Object System.Windows.Forms.Button
    $r2Button.Text = 'Start upload'
    $r2Button.SetBounds(365, 110, 150, 30)
    $r2Button.Enabled = $false
    $r2Box.Add_TextChanged({
        $r2Value = $r2Box.Text.Trim()
        $r2Count.Text = "$($r2Value.Length) / 64 characters"
        $r2Button.Enabled = $r2Value -match '^[a-fA-F0-9]{64}$'
    })
    $r2Button.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $r2Form.AcceptButton = $r2Button
    $r2Form.Controls.AddRange(@($r2Label, $r2Box, $r2Count, $r2Button))
    $r2Form.Add_Shown({ $r2Box.Focus() })
    try {
        if ($r2Form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Upload cancelled.' }
        $env:R2_SECRET_ACCESS_KEY = $r2Box.Text.Trim()
    } finally {
        $r2Box.Clear()
        $r2Form.Dispose()
    }
    & node (Join-Path $PSScriptRoot 'upload-r2.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Upload stopped. Run again to resume.' }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }
finally {
    Remove-Item Env:R2_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:R2_ACCESS_KEY_ID -ErrorAction SilentlyContinue
    Remove-Item Env:R2_ENDPOINT -ErrorAction SilentlyContinue
    Read-Host 'Press Enter to close'
}
