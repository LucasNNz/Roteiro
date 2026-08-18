Option Explicit
Dim shell, fso, baseDir, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Environment("PROCESS")("CORVO_FLOW_SILENT") = "1"
cmd = Chr(34) & baseDir & "\START_MANAGER.bat" & Chr(34)
shell.Run cmd, 0, False
