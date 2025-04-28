const fs = require("fs")
const path = require("path")

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, "public")
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir)
  console.log("Created public directory")
}

