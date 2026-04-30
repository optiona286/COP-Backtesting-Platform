Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Program Files\nodejs\node.exe"

shell.CurrentDirectory = appDir

If Not fso.FileExists(nodeExe) Then
  shell.Popup "Node.js was not found. Please install Node.js first.", 5, "OP PRO", 48
  WScript.Quit 1
End If

shell.Run "cmd.exe /c for /f ""tokens=5"" %P in ('netstat -ano ^| findstr /R /C:"":5000 .*LISTENING""') do taskkill /PID %P /F", 0, True
WScript.Sleep 800
shell.Run """" & nodeExe & """ """ & appDir & "\server.js""", 0, False
WScript.Sleep 1800
shell.Run "http://localhost:5000", 1, False
