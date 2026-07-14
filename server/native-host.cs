using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class NativeHost
{
    private const int MaxMessageBytes = 1024 * 1024;
    private const int StartupTimeoutSeconds = 600;
    private const string HealthUrl = "http://127.0.0.1:8000/health";

    private static readonly Stream Input = Console.OpenStandardInput();
    private static readonly Stream Output = Console.OpenStandardOutput();
    private static readonly object OutputLock = new object();
    private static readonly object BatchLock = new object();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer
    {
        MaxJsonLength = MaxMessageBytes
    };

    private static Process batchProcess;
    private static string batchJobId;
    private static bool batchCancelRequested;

    public static int Main()
    {
        try
        {
            string payload;
            while ((payload = ReadMessage()) != null)
            {
                try { HandleMessage(payload); }
                catch (Exception error)
                {
                    Log("Command failed: " + error);
                    SendState("error", error.Message, null);
                }
            }
            CancelBatch(null, false);
            return 0;
        }
        catch (Exception error)
        {
            Log("Fatal native host error: " + error);
            try { SendState("error", error.Message, null); } catch { }
            CancelBatch(null, false);
            return 1;
        }
    }

    private static void HandleMessage(string payload)
    {
        Dictionary<string, object> message = Json.Deserialize<Dictionary<string, object>>(payload);
        string command = GetString(message, "command");
        if (command == "ensure_running")
        {
            EnsureRecognizer();
            return;
        }
        if (command == "batch_transcribe")
        {
            StartBatch(payload, GetString(message, "jobId"));
            return;
        }
        if (command == "cancel_batch")
        {
            CancelBatch(GetString(message, "jobId"), true);
            return;
        }
        throw new InvalidOperationException("Unknown native host command: " + command);
    }

    private static string GetString(Dictionary<string, object> message, string key)
    {
        object value;
        return message != null && message.TryGetValue(key, out value) && value != null
            ? Convert.ToString(value)
            : "";
    }

    private static void EnsureRecognizer()
    {
        if (IsHealthy())
        {
            SendState("ready", "Local recognizer is ready.", null);
            return;
        }

        SendState("starting", "Starting the local GPU recognizer.", null);
        Process recognizer = StartRecognizer();
        DateTime deadline = DateTime.UtcNow.AddSeconds(StartupTimeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            if (IsHealthy())
            {
                SendState("ready", "Local recognizer is ready.", null);
                return;
            }
            if (recognizer.HasExited)
            {
                throw new InvalidOperationException(
                    "The recognizer exited before its health endpoint became ready. Check .runtime/logs/recognizer-task.log."
                );
            }
            Thread.Sleep(500);
        }
        throw new TimeoutException("The recognizer did not become ready within 10 minutes.");
    }

    private static Process StartRecognizer()
    {
        string serverDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(serverDirectory, "run-background-task.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException("Recognizer launcher was not found.", script);

        var info = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"",
            WorkingDirectory = Directory.GetParent(serverDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        Process process = Process.Start(info);
        if (process == null) throw new InvalidOperationException("Windows did not start the recognizer process.");
        Log("Started recognizer launcher PID " + process.Id + ".");
        return process;
    }

    private static void StartBatch(string requestJson, string jobId)
    {
        if (String.IsNullOrWhiteSpace(jobId)) throw new InvalidOperationException("The batch request is missing its job ID.");
        lock (BatchLock)
        {
            if (!String.IsNullOrEmpty(batchJobId))
                throw new InvalidOperationException("A full-video analysis is already running.");
            batchJobId = jobId;
            batchCancelRequested = false;
        }

        var thread = new Thread(delegate() { RunBatch(requestJson, jobId); });
        thread.IsBackground = true;
        thread.Name = "DubTranscriptBatch";
        thread.Start();
        SendState("batch_queued", "Full-video analysis queued.", jobId);
    }

    private static void RunBatch(string requestJson, string jobId)
    {
        bool terminalMessageSeen = false;
        int exitCode = -1;
        try
        {
            string serverDirectory = AppDomain.CurrentDomain.BaseDirectory;
            string projectRoot = Directory.GetParent(serverDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
            string python = Path.Combine(projectRoot, ".venv", "Scripts", "python.exe");
            string script = Path.Combine(serverDirectory, "batch_transcribe.py");
            string cuda = Path.Combine(projectRoot, ".runtime", "cuda");
            if (!File.Exists(python)) throw new FileNotFoundException("The project Python runtime was not found.", python);
            if (!File.Exists(script)) throw new FileNotFoundException("The batch transcription worker was not found.", script);

            var info = new ProcessStartInfo
            {
                FileName = python,
                Arguments = "\"" + script + "\"",
                WorkingDirectory = serverDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false)
            };
            if (Directory.Exists(cuda))
                info.EnvironmentVariables["PATH"] = cuda + ";" + info.EnvironmentVariables["PATH"];
            info.EnvironmentVariables["PYTHONUTF8"] = "1";

            using (Process process = new Process())
            {
                process.StartInfo = info;
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args)
                {
                    if (!String.IsNullOrWhiteSpace(args.Data)) Log("Batch stderr: " + args.Data);
                };
                if (!process.Start()) throw new InvalidOperationException("Windows did not start the batch worker.");
                lock (BatchLock)
                {
                    if (batchJobId == jobId) batchProcess = process;
                }
                process.BeginErrorReadLine();
                process.StandardInput.WriteLine(requestJson);
                process.StandardInput.Close();

                string line;
                while ((line = process.StandardOutput.ReadLine()) != null)
                {
                    Dictionary<string, object> childMessage;
                    try { childMessage = Json.Deserialize<Dictionary<string, object>>(line); }
                    catch
                    {
                        Log("Ignored non-JSON batch output: " + line);
                        continue;
                    }
                    string state = GetString(childMessage, "state");
                    if (state == "batch_complete" || state == "batch_error") terminalMessageSeen = true;
                    SendRaw(line);
                }
                process.WaitForExit();
                exitCode = process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Log("Batch worker failed: " + error);
            if (!terminalMessageSeen) SendState("batch_error", error.Message, jobId);
            terminalMessageSeen = true;
        }
        finally
        {
            bool cancelled;
            lock (BatchLock)
            {
                cancelled = batchJobId == jobId && batchCancelRequested;
                if (batchJobId == jobId)
                {
                    batchProcess = null;
                    batchJobId = null;
                    batchCancelRequested = false;
                }
            }
            if (cancelled)
                SendState("batch_cancelled", "Full-video analysis cancelled.", jobId);
            else if (exitCode != 0 && !terminalMessageSeen)
                SendState("batch_error", "The batch worker exited with code " + exitCode + ".", jobId);
        }
    }

    private static void CancelBatch(string requestedJobId, bool notifyIfMissing)
    {
        Process process = null;
        string activeJobId = null;
        lock (BatchLock)
        {
            activeJobId = batchJobId;
            if (String.IsNullOrEmpty(activeJobId) || (
                !String.IsNullOrEmpty(requestedJobId) && requestedJobId != activeJobId
            ))
            {
                if (notifyIfMissing) SendState("batch_cancelled", "No matching batch job is running.", requestedJobId);
                return;
            }
            batchCancelRequested = true;
            process = batchProcess;
        }
        try
        {
            if (process != null && !process.HasExited) process.Kill();
        }
        catch (Exception error) { Log("Could not stop batch process: " + error.Message); }
    }

    private static bool IsHealthy()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(HealthUrl);
            request.Method = "GET";
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                string body = reader.ReadToEnd().Replace(" ", "").Replace("\r", "").Replace("\n", "");
                return response.StatusCode == HttpStatusCode.OK && body.Contains("\"ready\":true");
            }
        }
        catch { return false; }
    }

    private static string ReadMessage()
    {
        byte[] lengthBytes = ReadExact(4);
        if (lengthBytes == null) return null;
        int length = BitConverter.ToInt32(lengthBytes, 0);
        if (length < 0 || length > MaxMessageBytes) throw new InvalidDataException("Invalid native message length.");
        byte[] payload = ReadExact(length);
        if (payload == null) throw new EndOfStreamException("Native message ended early.");
        return Encoding.UTF8.GetString(payload);
    }

    private static byte[] ReadExact(int count)
    {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = Input.Read(buffer, offset, count - offset);
            if (read == 0) return offset == 0 ? null : buffer;
            offset += read;
        }
        return buffer;
    }

    private static void SendState(string state, string message, string jobId)
    {
        var payload = new Dictionary<string, object>();
        payload["state"] = state;
        payload["message"] = message;
        if (!String.IsNullOrEmpty(jobId)) payload["jobId"] = jobId;
        SendRaw(Json.Serialize(payload));
    }

    private static void SendRaw(string json)
    {
        byte[] payload = Encoding.UTF8.GetBytes(json);
        if (payload.Length > MaxMessageBytes)
            throw new InvalidDataException("Native response exceeded the 1 MB Chrome limit.");
        byte[] length = BitConverter.GetBytes(payload.Length);
        lock (OutputLock)
        {
            Output.Write(length, 0, length.Length);
            Output.Write(payload, 0, payload.Length);
            Output.Flush();
        }
    }

    private static void Log(string message)
    {
        try
        {
            string projectRoot = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
            string logDirectory = Path.Combine(projectRoot, ".runtime", "logs");
            Directory.CreateDirectory(logDirectory);
            File.AppendAllText(Path.Combine(logDirectory, "native-host.log"), "[" + DateTime.Now.ToString("o") + "] " + message + Environment.NewLine, Encoding.UTF8);
        }
        catch { }
    }
}
