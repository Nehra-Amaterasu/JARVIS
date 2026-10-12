Dim WinScriptHost
Set WinScriptHost = CreateObject("WScript.Shell")
' Run jarvis.py silently in the background without opening a command prompt window
WinScriptHost.Run """C:\Projects\JARVIS\.venv\Scripts\python.exe"" ""C:\Projects\JARVIS\core\jarvis.py""", 0, False
Set WinScriptHost = Nothing
