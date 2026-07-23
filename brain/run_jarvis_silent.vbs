Dim WinScriptHost
Set WinScriptHost = CreateObject("WScript.Shell")
' Run jarvis.py silently in the background without opening a command prompt window
WinScriptHost.Run """C:\Projects\jarvis-room\brain\.venv311_gpu\Scripts\python.exe"" ""C:\Projects\jarvis-room\brain\jarvis.py""", 0, False
Set WinScriptHost = Nothing
