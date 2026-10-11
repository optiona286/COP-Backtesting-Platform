Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Program Files\nodejs\node.exe"
shell.CurrentDirectory = appDir
If Not fso.FileExists(nodeExe) Then
  shell.Popup "Node.js was not found. Please install Node.js first.", 8, "OP PRO Online", 48
  WScript.Quit 1
End If
Function PingService()
  On Error Resume Next
  Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  req.setTimeouts 500, 500, 500, 500
  req.open "GET", "http://127.0.0.1:5100/ping", False
  req.send
  If Err.Number = 0 Then
    If req.status = 200 Then PingService = req.responseText
  End If
  Err.Clear
  On Error GoTo 0
End Function
reply = PingService()
If Len(reply) > 0 And InStr(reply, "OP PRO Online") = 0 Then
  shell.Popup "Port 5100 is used by another service. Choose a different PORT and launch manually.", 10, "OP PRO Online", 48
  WScript.Quit 1
End If
If InStr(reply, "OP PRO Online") = 0 Then
  shell.Run """" & nodeExe & """ """ & appDir & "\server.js""", 0, False
End If
For attempt = 1 To 60
  reply = PingService()
  If InStr(reply, "OP PRO Online") > 0 Then
    shell.Run "http://localhost:5100", 1, False
    WScript.Quit 0
  End If
  WScript.Sleep 500
Next
shell.Popup "Server is not ready. Run npm start in this folder to inspect the error. The original OP PRO was not stopped.", 10, "OP PRO Online", 48
