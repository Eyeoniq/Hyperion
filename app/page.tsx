import SerialMonitor from "@/components/SerialMonitor"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-8 md:p-24">
      <h1 className="text-4xl font-bold mb-4">AMB82 Mini Camera Serial Monitor</h1>
      <p className="text-gray-500 mb-8 text-center max-w-2xl">
        Connect to your AMB82 Mini Camera over WiFi and monitor serial output in real-time. You can also send commands
        to the camera using the input field below.
      </p>
      <SerialMonitor />
    </main>
  )
}

