"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function SerialMonitor() {
  const [serialData, setSerialData] = useState<string[]>([])
  const [command, setCommand] = useState<string>("")
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const socketRef = useRef<any>(null)
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Dynamically import socket.io-client to avoid SSR issues
    import("socket.io-client").then(({ io }) => {

    // Create socket connection
    socketRef.current = io("http://localhost:3001")

    // Handle connection status
    socketRef.current.on("connect", () => {
      setIsConnected(true)
    })

    socketRef.current.on("disconnect", () => {
      setIsConnected(false)
    })

    // Handle incoming serial data
    socketRef.current.on("serialData", (data: string) => {
      setSerialData((prevData) => [...prevData, data].slice(-100))
      })
    })

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])

  // Auto-scroll to bottom when new data arrives
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [serialData])

  // Send command to the camera
  const sendCommand = () => {
    if (command.trim() && socketRef.current) {
      socketRef.current.emit("sendCommand", command)
      setSerialData((prevData) => [...prevData, `> ${command}`].slice(-100))
      setCommand("")
    }
  }

  // Handle Enter key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      sendCommand()
    }
  }

  return (
    <div className="w-full max-w-2xl flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}></div>
        <span className="text-sm">{isConnected ? "Connected to AMB82 Camera" : "Disconnected"}</span>
      </div>

      <div ref={terminalRef} className="bg-gray-800 text-white p-4 rounded-lg h-96 overflow-y-auto font-mono">
        {serialData.map((line, index) => (
          <div key={index} className={`mb-1 ${line.startsWith(">") ? "text-blue-300" : ""}`}>
            {line}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command..."
          className="flex-1"
        />
        <Button onClick={sendCommand} disabled={!isConnected}>
          Send
        </Button>
      </div>
    </div>
  )
}

