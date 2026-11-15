' Worship Caster - start without a console window (hidden).
' To quit: press the power button on the control screen.
Option Explicit
Dim sh, fso, dir, dataDir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = sh.ExpandEnvironmentStrings("%APPDATA%") & "\WorshipCaster"
If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir
sh.Environment("PROCESS")("WC_DATA_DIR") = dataDir
sh.CurrentDirectory = dir & "\app"
sh.Run """" & dir & "\node\node.exe"" server.js", 0, False
