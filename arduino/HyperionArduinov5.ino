#include "WiFi.h"
#include "StreamIO.h"
#include "VideoStream.h"
#include "RTSP.h"
#include "NNObjectDetection.h"
#include "VideoStreamOverlay.h"
#include "ObjectClassList.h"
#include <WiFiClient.h>  // Added for TCP client functionality


#define CHANNEL 0
#define CHANNELNN 3 

// Lower resolution for NN processing
#define NNWIDTH  1920
#define NNHEIGHT 1080

// Server connection settings - UPDATE THESE WITH YOUR SERVER DETAILS
#define SERVER_IP "192.168.100.141"  // Replace with your actual server IP address
#define SERVER_PORT 3001           // Match the port in your Node.js server

// IMPORTANT: Set a unique camera ID for each camera (1, 2, or 3)
#define CAMERA_ID 1  // Change this to 2 or 3 for other cameras

VideoSetting config(VIDEO_FHD, 30, VIDEO_H264, 0);
VideoSetting configNN(NNWIDTH, NNHEIGHT, 10, VIDEO_RGB, 0);
NNObjectDetection ObjDet;
RTSP rtsp;
StreamIO videoStreamer(1, 1);
StreamIO videoStreamerNN(1, 1);
WiFiClient client;  // TCP client for server communication

char ssid[] = "Hyperion";   // network SSID (name)
char pass[] = "1234567890";       // network password
int status = WL_IDLE_STATUS;

IPAddress ip;
int rtsp_portnum;
unsigned long lastConnectionAttempt = 0;
const int connectionRetryInterval = 5000; // 5 seconds between connection attempts

// Buffer for formatting messages to send to server
char msgBuffer[512];

// Function to connect to the server
void connectToServer() {
  if (!client.connected()) {
      Serial.print("Connecting to server at ");
      Serial.print(SERVER_IP);
      Serial.print(":");
      Serial.println(SERVER_PORT);
      
      if (client.connect(SERVER_IP, SERVER_PORT)) {
          Serial.println("Connected to server successfully");
          
          // Send initial connection message with camera ID
          snprintf(msgBuffer, sizeof(msgBuffer), "CAM%d:AMB82 Camera %d connected. IP: %d.%d.%d.%d, RTSP URL: rtsp://%d.%d.%d.%d:%d", 
                  CAMERA_ID, CAMERA_ID, ip[0], ip[1], ip[2], ip[3], ip[0], ip[1], ip[2], ip[3], rtsp_portnum);
          client.println(msgBuffer);
      } else {
          Serial.println("Connection to server failed");
      }
      
      lastConnectionAttempt = millis();
  }
}

printf "Hello World"

// Function to send data to the server
void sendToServer(const char* message) {
  // Try to connect if not connected
  if (!client.connected() && (millis() - lastConnectionAttempt > connectionRetryInterval)) {
      connectToServer();
  }
  
  // Send message if connected
  if (client.connected()) {
      // Prefix all messages with camera ID
      char prefixedMsg[512];
      snprintf(prefixedMsg, sizeof(prefixedMsg), "CAM%d:%s", CAMERA_ID, message);
      client.println(prefixedMsg);
  }
}

//function to check if image is car motorbike van or truck 
bool isVehicle(int type){
  if((type == 2)||(type == 3)||(type == 5)||(type == 7)){
    return true;
  }else{return false;}
}

void setup() {
  Serial.begin(115200);

  // attempt to connect to Wifi network:
  while (status != WL_CONNECTED) {
      Serial.print("Attempting to connect to WPA SSID: ");
      Serial.println(ssid);
      status = WiFi.begin(ssid, pass);

      // wait 2 seconds for connection:
      delay(2000);
  }
  ip = WiFi.localIP();
  
  Serial.print("Connected to WiFi. IP address: ");
  Serial.println(ip);

  // Configure camera video channels with video format information
  // Adjust the bitrate based on your WiFi network quality
  config.setBitrate(2 * 1024 * 1024);     // Recommend to use 2Mbps for RTSP streaming to prevent network congestion
  Camera.configVideoChannel(CHANNEL, config);
  Camera.configVideoChannel(CHANNELNN, configNN);
  Camera.videoInit();

  // Configure RTSP with corresponding video format information
  rtsp.configVideo(config);
  rtsp.begin();
  rtsp_portnum = rtsp.getPort();

  // Configure object detection with corresponding video format information
  // Select Neural Network(NN) task and models
  ObjDet.configVideo(configNN);
  ObjDet.modelSelect(OBJECT_DETECTION, DEFAULT_YOLOV7TINY, NA_MODEL, NA_MODEL);
  ObjDet.begin();

  // Configure StreamIO object to stream data from video channel to RTSP
  videoStreamer.registerInput(Camera.getStream(CHANNEL));
  videoStreamer.registerOutput(rtsp);
  if (videoStreamer.begin() != 0) {
      Serial.println("StreamIO link start failed");
      sendToServer("StreamIO link start failed");
  }

  // Start data stream from video channel
  Camera.channelBegin(CHANNEL);

  // Configure StreamIO object to stream data from RGB video channel to object detection
  videoStreamerNN.registerInput(Camera.getStream(CHANNELNN));
  videoStreamerNN.setStackSize();
  videoStreamerNN.setTaskPriority();
  videoStreamerNN.registerOutput(ObjDet);
  if (videoStreamerNN.begin() != 0) {
      Serial.println("StreamIO link start failed");
      sendToServer("StreamIO link start failed");
  }

  // Start video channel for NN
  Camera.channelBegin(CHANNELNN);

  // Start OSD drawing on RTSP video channel
  OSD.configVideo(CHANNEL, config);
  OSD.begin();
  
  // Connect to server after everything is set up
  connectToServer();
  
  // Send initialization complete message
  sendToServer("AMB82 Camera initialization complete");
}

void loop() {
  // Check if we're still connected to the server
  if (!client.connected() && (millis() - lastConnectionAttempt > connectionRetryInterval)) {
      Serial.println("Connection to server lost. Attempting to reconnect...");
      connectToServer();
  }

  std::vector<ObjectDetectionResult> results = ObjDet.getResult();

  uint16_t im_h = config.height();
  uint16_t im_w = config.width();

  // Format RTSP URL for both serial and server
  snprintf(msgBuffer, sizeof(msgBuffer), "Network URL for RTSP Streaming: rtsp://%d.%d.%d.%d:%d", 
           ip[0], ip[1], ip[2], ip[3], rtsp_portnum);
  Serial.println(msgBuffer);
  sendToServer(msgBuffer);
  Serial.println(" ");

  // Count cars, vans and trucks
  int carCount = 0;
  for (uint32_t i = 0; i < ObjDet.getResultCount(); i++) {
      int obj_type = results[i].type();
      if (isVehicle(obj_type)) {  // Assuming 2 is the obj_type for cars
          carCount++;
      }
  }

  // send print car
  snprintf(msgBuffer, sizeof(msgBuffer), "Vehicles detected = %d", carCount);
  Serial.println(msgBuffer);
  sendToServer(msgBuffer);
  
  OSD.createBitmap(CHANNEL);

  if (ObjDet.getResultCount() > 0) {
      for (uint32_t i = 0; i < ObjDet.getResultCount(); i++) {
          int obj_type = results[i].type();
          if (isVehicle(obj_type)) {    // check if item should be ignored
              ObjectDetectionResult item = results[i];
              // Result coordinates are floats ranging from 0.00 to 1.00
              // Multiply with RTSP resolution to get coordinates in pixels
              int xmin = (int)(item.xMin() * im_w);
              int xmax = (int)(item.xMax() * im_w);
              int ymin = (int)(item.yMin() * im_h);
              int ymax = (int)(item.yMax() * im_h);

              // Format detection result for both serial and server
              snprintf(msgBuffer, sizeof(msgBuffer), "Vehicle %lu:\t%d %d %d %d (confidence: %d%%)", 
                       i, xmin, xmax, ymin, ymax, item.score());
              Serial.println(msgBuffer);
              sendToServer(msgBuffer);
              
              // Draw boundary box
              OSD.drawRect(CHANNEL, xmin, ymin, xmax, ymax, 3, OSD_COLOR_WHITE);

              // Print identification text
              char text_str[20];
              snprintf(text_str, sizeof(text_str), "Car %d", item.score());
              OSD.drawText(CHANNEL, xmin, ymin - OSD.getTextHeight(CHANNEL), text_str, OSD_COLOR_CYAN);
          }
      }
  }
  OSD.update(CHANNEL);

  // Check for any data from the server (commands)
  while (client.available()) {
      String command = client.readStringUntil('\n');
      command.trim();
      
      // Check if the command is intended for this camera
      if (command.startsWith("CAM") && command.length() >= 5) {
          int targetCam = command.substring(3, 4).toInt();
          if (targetCam == CAMERA_ID) {
              // Extract the actual command (after "CAMx:")
              String actualCommand = command.substring(5);
              
              Serial.print("Received command from server: ");
              Serial.println(actualCommand);
              
              // Echo back the command as acknowledgment
              snprintf(msgBuffer, sizeof(msgBuffer), "Command received: %s", actualCommand.c_str());
              sendToServer(msgBuffer);
              
              // Here you can add code to handle specific commands from the server
          }
      } else {
          // Handle broadcast commands (no specific camera prefix)
          Serial.print("Received broadcast command: ");
          Serial.println(command);
          
          snprintf(msgBuffer, sizeof(msgBuffer), "Broadcast command received: %s", command.c_str());
          sendToServer(msgBuffer);
      }
  }

  // delay to wait for new results
  delay(1000);
}

