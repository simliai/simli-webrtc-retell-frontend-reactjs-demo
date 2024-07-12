const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');  // Import CORS module
const Retell = require('retell-sdk');
require('dotenv').config();

const app = express();
const port = 8080;

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());

const retell = new Retell({apiKey:process.env.REACT_APP_RETELL_KEY});

app.post('/register-call-on-your-server', async (req, res) => {
  try {
    const agentId = req.body.agentId;
    const webCallResponse = await retell.call.createWebCall({ agent_id: agentId });

    res.json({
      access_token: webCallResponse.access_token,
    });
  } catch (error) {
    console.error("Failed to register call:", error);
    res.status(500).json({ error: "Failed to register call" });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});