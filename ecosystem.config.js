module.exports = {
    apps: [{
        name: "OctoMedia",
        script: "./server.js",
        env: {
            NODE_ENV: "production",
            PORT: 3009
        }
    }]
}
