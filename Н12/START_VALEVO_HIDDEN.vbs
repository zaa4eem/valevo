Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

BaseDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = BaseDir

BotExe = BaseDir & "\dist\VALEVO_BOT.exe"
TvExe = BaseDir & "\dist\VALEVO_TV_BOARD.exe"

If FSO.FileExists(BotExe) Then
    WshShell.Run Chr(34) & BotExe & Chr(34), 0, False
End If

WScript.Sleep 2500

If FSO.FileExists(TvExe) Then
    WshShell.Run Chr(34) & TvExe & Chr(34), 0, False
End If
