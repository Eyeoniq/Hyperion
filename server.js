const express = require("express")
const { createServer } = require("http")
const { Server: SocketIOServer } = require("socket.io")
const net = require("net")
const path = require("path")
const fs = require("fs")

const app = express()
const server = createServer(app)
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})

// Serve static files from the public directory
app.use(express.static("public"))

// Add a simple route for the root path
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html")
})

// Track active camera connections with debounce mechanism
const cameraConnections = {
  1: {
    socket: null,
    lastSeen: 0,
    connected: false,
    rtspUrl: null,
    disconnectedAt: 0, // When the camera was physically disconnected
    reportedStatus: false, // The status reported to clients (true = connected, false = disconnected)
    peakDetection: {
      currentCount: 0,
      peakCount: 0,
      lastReset: null,
      recording: false,
      history: [],
    },
  },
  2: {
    socket: null,
    lastSeen: 0,
    connected: false,
    rtspUrl: null,
    disconnectedAt: 0,
    reportedStatus: false,
    peakDetection: {
      currentCount: 0,
      peakCount: 0,
      lastReset: null,
      recording: false,
      history: [],
    },
  },
  3: {
    socket: null,
    lastSeen: 0,
    connected: false,
    rtspUrl: null,
    disconnectedAt: 0,
    reportedStatus: false,
    peakDetection: {
      currentCount: 0,
      peakCount: 0,
      lastReset: null,
      recording: false,
      history: [],
    },
  },
}

// Connection timeout and debounce settings
const CONNECTION_TIMEOUT = 60000 // 60 seconds
const DISCONNECT_DEBOUNCE = 6000 // 6 seconds before reporting disconnected

// Check for stale connections and update status with debounce
setInterval(() => {
  const now = Date.now()

  for (let cameraId = 1; cameraId <= 3; cameraId++) {
    const camera = cameraConnections[cameraId]

    // Check if camera is physically connected
    const physicallyConnected = camera.connected && now - camera.lastSeen <= CONNECTION_TIMEOUT

    // If camera was connected but is now physically disconnected
    if (camera.connected && !physicallyConnected) {
      console.log(`Camera ${cameraId} connection timed out or lost`)
      camera.connected = false
      camera.disconnectedAt = now
      // Don't change reportedStatus yet - wait for debounce
    }

    // If camera is physically disconnected, check if we should update the reported status
    if (!camera.connected) {
      // Only report disconnected if it's been disconnected for the debounce period
      if (camera.reportedStatus && now - camera.disconnectedAt >= DISCONNECT_DEBOUNCE) {
        camera.reportedStatus = false
        console.log(`Camera ${cameraId} reported as disconnected after debounce period`)

        // Notify clients
        io.emit("serialData", {
          cameraId: cameraId,
          message: `Camera ${cameraId} disconnected (debounced)`,
        })

        // Also send an explicit status update
        io.emit("serialData", {
          cameraId: cameraId,
          message: `Camera ${cameraId} status: Disconnected`,
        })
      }
    }
    // If camera is physically connected but not reported as connected
    else if (camera.connected && !camera.reportedStatus) {
      camera.reportedStatus = true
      console.log(`Camera ${cameraId} reported as connected`)

      // Notify clients
      io.emit("serialData", {
        cameraId: cameraId,
        message: `Camera ${cameraId} status: Connected`,
      })
    }
  }
}, 1000) // Check every second

// Modify the TCP server connection handler to work with debounce
const tcpServer = net.createServer((socket) => {
  console.log("Camera connected from:", socket.remoteAddress)

  // Set encoding to utf8 to handle text data
  socket.setEncoding("utf8")

  // Increase keep-alive settings to prevent connection drops
  socket.setKeepAlive(true, 5000) // More frequent keep-alive packets

  // Increase timeout to prevent premature disconnections
  socket.setTimeout(120000) // 2 minutes timeout

  // Buffer to collect partial messages
  let dataBuffer = ""

  // Track which camera this connection belongs to
  let cameraId = null

  // Handle data from the camera
  socket.on("data", (data) => {
    // Append new data to buffer
    dataBuffer += data.toString()

    // Process complete lines
    const lines = dataBuffer.split("\n")

    // Keep the last line if it's incomplete (no newline at the end)
    dataBuffer = lines.pop() || ""

    // Process each complete line
    lines.forEach((line) => {
      if (line.trim()) {
        processMessage(line.trim())
      }
    })
  })

  // Process a single message
  function processMessage(message) {
    // Check if message has camera ID prefix (CAM1:, CAM2:, CAM3:)
    const cameraMatch = message.match(/^CAM([1-3]):(.*)$/)

    if (cameraMatch) {
      const camId = Number.parseInt(cameraMatch[1])
      const actualMessage = cameraMatch[2]

      // Store the camera ID for this connection if not already set
      if (!cameraId) {
        cameraId = camId
        console.log(`Identified as Camera ${cameraId}`)

        // Store the socket in our tracking object
        cameraConnections[cameraId].socket = socket
        cameraConnections[cameraId].connected = true
        cameraConnections[cameraId].lastSeen = Date.now()

        // If not already reported as connected, report it now
        if (!cameraConnections[cameraId].reportedStatus) {
          cameraConnections[cameraId].reportedStatus = true

          // Send explicit connection status message
          io.emit("serialData", {
            cameraId: cameraId,
            message: `Camera ${cameraId} status: Connected`,
          })
        }
      }

      // Update last seen timestamp
      cameraConnections[cameraId].lastSeen = Date.now()

      // Skip heartbeat messages from the log but still update lastSeen
      if (actualMessage.includes("Heartbeat")) {
        return
      }

      console.log(`Broadcasting to clients (Camera ${camId}):`, actualMessage)

      // Emit with camera ID for client-side routing
      io.emit("serialData", {
        cameraId: camId,
        message: actualMessage,
      })

      // Check if this message contains an RTSP URL
      if (actualMessage.includes("RTSP Streaming") && actualMessage.includes("rtsp://")) {
        const urlMatch = actualMessage.match(/rtsp:\/\/[0-9.]+:[0-9]+/)
        if (urlMatch) {
          const rtspUrl = urlMatch[0]
          console.log(`Detected RTSP URL for Camera ${camId}: ${rtspUrl}`)

          // Store the RTSP URL
          cameraConnections[camId].rtspUrl = rtspUrl

          // Notify clients about the RTSP URL
          io.emit("rtspUrlDetected", {
            cameraId: camId,
            rtspUrl: rtspUrl,
          })
        }
      }

      // Check if this is object detection count for peak detection tracking
      if (actualMessage.includes("Vehicles detected =")) {
        const countMatch = actualMessage.match(/Vehicles detected = (\d+)/)
        if (countMatch && countMatch[1]) {
          const count = Number.parseInt(countMatch[1])

          // Update current count for peak detection
          cameraConnections[camId].peakDetection.currentCount = count

          // Check if this is a new peak
          if (count > cameraConnections[camId].peakDetection.peakCount) {
            cameraConnections[camId].peakDetection.peakCount = count
            console.log(`New peak detected for Camera ${camId}: ${count} vehicles`)
          }
        }
      }
    } else {
      // For messages without proper prefix, use stored camera ID if available
      if (cameraId) {
        // Update last seen timestamp
        cameraConnections[cameraId].lastSeen = Date.now()

        console.log(`Broadcasting to clients (Camera ${cameraId}, no prefix):`, message)
        io.emit("serialData", {
          cameraId: cameraId,
          message: message,
        })
      } else {
        // If no camera ID is known yet, broadcast as general message
        console.log("Broadcasting to clients (unknown camera):", message)
        io.emit("serialData", {
          cameraId: 0, // 0 means unknown/general
          message: message,
        })
      }
    }
  }

  // Handle camera disconnection
  socket.on("end", () => {
    handleDisconnect("normal disconnect")
  })

  // Handle errors
  socket.on("error", (err) => {
    console.error("Socket error:", err)
    // Don't close the connection on all errors
    if (err.code !== "ECONNRESET" && err.code !== "EPIPE") {
      handleDisconnect(`error: ${err.message}`)
    }
  })

  // Handle timeouts
  socket.on("timeout", () => {
    console.log("Socket timeout")
    // Don't disconnect on timeout, just log it
    socket.resume()
  })

  // Handle close
  socket.on("close", (hadError) => {
    handleDisconnect(hadError ? "closed with error" : "closed")
  })

  // Helper function to handle all disconnection scenarios
  function handleDisconnect(reason) {
    if (cameraId) {
      console.log(`Camera ${cameraId} physically disconnected (${reason})`)

      // Mark as physically disconnected in our tracking object
      cameraConnections[cameraId].connected = false
      cameraConnections[cameraId].socket = null
      cameraConnections[cameraId].disconnectedAt = Date.now()

      // Log the disconnect but don't notify clients yet - wait for debounce
      console.log(`Camera ${cameraId} disconnected, starting debounce timer (${DISCONNECT_DEBOUNCE}ms)`)

      // Only log the disconnect event, don't change status yet
      io.emit("serialData", {
        cameraId: cameraId,
        message: `Camera ${cameraId} connection event: ${reason}`,
      })
    } else {
      console.log(`Unknown camera disconnected (${reason})`)
      io.emit("serialData", {
        cameraId: 0,
        message: `Unknown camera disconnected (${reason})`,
      })
    }
  }
})

// Start TCP server on port 3001
tcpServer.listen(3001, () => {
  console.log("TCP Server listening for cameras on port 3001")
})

// Handle WebSocket connections from browsers
io.on("connection", (socket) => {
  console.log("Browser client connected")

  // Send welcome message to the browser
  socket.emit("serialData", {
    cameraId: 0,
    message: "Connected to server. Waiting for camera data...",
  })

  // Send current camera connection status
  for (let cameraId = 1; cameraId <= 3; cameraId++) {
    const camera = cameraConnections[cameraId]
    const status = camera.reportedStatus ? "Connected" : "Disconnected"

    socket.emit("serialData", {
      cameraId: cameraId,
      message: `Camera ${cameraId} status: ${status}`,
    })

    // If camera is connected and has an RTSP URL, send it
    if (camera.connected && camera.rtspUrl) {
      socket.emit("rtspUrlDetected", {
        cameraId: cameraId,
        rtspUrl: camera.rtspUrl,
      })
    }
  }

  // Handle recording control commands
  socket.on("startRecording", (data) => {
    const { cameraId } = data
    console.log(`Start recording peak detection for Camera ${cameraId}`)

    if (cameraConnections[cameraId]) {
      cameraConnections[cameraId].peakDetection.recording = true

      // Notify all clients
      io.emit("serialData", {
        cameraId: cameraId,
        message: `Peak detection recording started for Camera ${cameraId}`,
      })
    }
  })

  socket.on("stopRecording", (data) => {
    const { cameraId } = data
    console.log(`Stop recording peak detection for Camera ${cameraId}`)

    if (cameraConnections[cameraId]) {
      cameraConnections[cameraId].peakDetection.recording = false

      // Notify all clients
      io.emit("serialData", {
        cameraId: cameraId,
        message: `Peak detection recording stopped for Camera ${cameraId}`,
      })
    }
  })

  socket.on("clearHistory", (data) => {
    const { cameraId } = data
    console.log(`Clear peak detection history for Camera ${cameraId}`)

    if (cameraConnections[cameraId]) {
      cameraConnections[cameraId].peakDetection.history = []

      // Notify all clients
      io.emit("serialData", {
        cameraId: cameraId,
        message: `Peak detection history cleared for Camera ${cameraId}`,
      })
    }
  })

  // Handle global recording control commands
  socket.on("startAllRecordings", () => {
    console.log("Start recording peak detection for all cameras")

    for (let cameraId = 1; cameraId <= 3; cameraId++) {
      if (cameraConnections[cameraId]) {
        cameraConnections[cameraId].peakDetection.recording = true
      }
    }

    // Notify all clients
    io.emit("serialData", {
      cameraId: 0,
      message: `Peak detection recording started for all cameras`,
    })
  })

  socket.on("stopAllRecordings", () => {
    console.log("Stop recording peak detection for all cameras")

    for (let cameraId = 1; cameraId <= 3; cameraId++) {
      if (cameraConnections[cameraId]) {
        cameraConnections[cameraId].peakDetection.recording = false
      }
    }

    // Notify all clients
    io.emit("serialData", {
      cameraId: 0,
      message: `Peak detection recording stopped for all cameras`,
    })
  })

  socket.on("clearAllHistory", () => {
    console.log("Clear peak detection history for all cameras")

    for (let cameraId = 1; cameraId <= 3; cameraId++) {
      if (cameraConnections[cameraId]) {
        cameraConnections[cameraId].peakDetection.history = []
      }
    }

    // Notify all clients
    io.emit("serialData", {
      cameraId: 0,
      message: `Peak detection history cleared for all cameras`,
    })
  })

  // Add this handler for status check requests
  socket.on("checkCameraStatus", () => {
    console.log("Client requested camera status check")

    for (let cameraId = 1; cameraId <= 3; cameraId++) {
      const now = Date.now()
      const camera = cameraConnections[cameraId]

      // Check if camera is physically connected
      const physicallyConnected = camera.connected && now - camera.lastSeen <= CONNECTION_TIMEOUT

      // If camera was connected but is now physically disconnected
      if (camera.connected && !physicallyConnected) {
        console.log(`Camera ${cameraId} connection timed out during status check`)
        camera.connected = false
        camera.disconnectedAt = now
        // Don't change reportedStatus yet - wait for debounce
      }

      // Send the current reported status
      const status = camera.reportedStatus ? "Connected" : "Disconnected"
      console.log(`Sending camera ${cameraId} status: ${status}`)

      socket.emit("serialData", {
        cameraId: cameraId,
        message: `Camera ${cameraId} status: ${status}`,
      })

      // If camera is connected and has an RTSP URL, send it
      if (camera.connected && camera.rtspUrl) {
        socket.emit("rtspUrlDetected", {
          cameraId: cameraId,
          rtspUrl: camera.rtspUrl,
        })
      }
    }
  })

  // Handle commands from the browser to be sent to the camera
  socket.on("sendCommand", (data) => {
    const { cameraId, command } = data
    console.log(`Command received from browser for Camera ${cameraId}:`, command)

    // Check if the target camera is connected
    if (cameraConnections[cameraId].connected && cameraConnections[cameraId].socket) {
      console.log(`Sending command to camera ${cameraId}:`, command)

      // Format command with camera ID prefix
      const formattedCommand = `CAM${cameraId}:${command}`

      // Send the command to the specific camera
      cameraConnections[cameraId].socket.write(formattedCommand + "\n")

      socket.emit("serialData", {
        cameraId: cameraId,
        message: "> " + command,
      })
    } else {
      console.log(`Camera ${cameraId} not connected to send command`)
      socket.emit("serialData", {
        cameraId: cameraId,
        message: `Error: Camera ${cameraId} not connected to send command`,
      })
    }
  })

  // Handle browser disconnection
  socket.on("disconnect", () => {
    console.log("Browser client disconnected")
  })
})

// Start HTTP server for WebSocket on port 3000
server.listen(3000, () => {
  console.log("HTTP Server running on port 3000")
})

