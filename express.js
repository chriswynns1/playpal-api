require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const axios = require("axios");
const path = require("path");
const admin = require("firebase-admin");
const serviceAccount = require("./playpal-63bee-firebase-adminsdk-93g9b-349e99a35e.json");
const { TextServiceClient } = require("@google-ai/generativelanguage");
const { GoogleAuth } = require("google-auth-library");
const STEAM_KEY = process.env.STEAM_KEY;
const PALM_KEY = process.env.PALM_KEY;
const GRID_KEY = process.env.GRID_KEY;
const RAWG_KEY = process.env.RAWG_KEY;

// enable cors
app.use(cors());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const MODEL_NAME = "models/text-bison-001";
const API_KEY = PALM_KEY;
const client = new TextServiceClient({
  authClient: new GoogleAuth().fromAPIKey(API_KEY),
});

const firestore = admin.firestore();
let customToken; // Define customToken at a higher scope

const SteamAuth = require("node-steam-openid");

const steam = new SteamAuth({
  realm: "http://localhost:5000", // Site name displayed to users on logon
  returnUrl: "http://localhost:5000/auth/steam/authenticate", // Your return route
  apiKey: STEAM_KEY, // Steam API key
});

app.get("/auth/steam", async (req, res) => {
  const redirectUrl = await steam.getRedirectUrl();
  return res.redirect(redirectUrl);
});

app.get("/testapi", function (req, res, next) {
  // Check if customToken is available
  if (!customToken) {
    return res.status(500).json({ error: "Custom token not generated yet" });
  }

  res.json({ customToken });
});

app.get("/steamgrid/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    // Make a request to SteamGrid API
    const response = await axios.get(
      `https://www.steamgriddb.com/api/v2/games/steam/${gameId}`,
      {
        headers: {
          Authorization: `Bearer ${GRID_KEY}`,
        },
      }
    );

    // Forward the response to your frontend
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/steamgrid/hero/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    // Make a request to SteamGrid API
    const response = await axios.get(
      `https://www.steamgriddb.com/api/v2/heroes/steam/${gameId}`,
      {
        headers: {
          Authorization: `Bearer ${GRID_KEY}`,
        },
      }
    );

    // Forward the response to your frontend
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// vertical image
app.get("/steamgrid/vert/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    // Make a request to SteamGrid API
    const response = await axios.get(
      `https://www.steamgriddb.com/api/v2/grids/steam/${gameId}`,
      {
        headers: {
          Authorization: `Bearer ${GRID_KEY}`,
        },
      }
    );

    // Forward the response to your frontend
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/steam/price/:gameId", async (req, res) => {
  const { gameId } = req.params;

  try {
    // Make a request to Steam API
    const response = await axios.get(
      `https://store.steampowered.com/api/appdetails?filters=price_overview&appids=${gameId}`
    );

    const appDetails = response.data[gameId];

    if (appDetails && appDetails.success) {
      const priceOverview = appDetails.data.price_overview;
      res.json({ success: true, data: priceOverview });
    } else {
      res.json({ success: false, message: "Invalid response from Steam API" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/refresh/:steamId", async (req, res) => {
  const { steamId } = req.params;

  try {
    const response = await axios.get(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
    );

    const libraryDetails = response.data.response.games;

    const firestore = admin.firestore();
    const dataToStore = {
      games: libraryDetails,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const userDoc = await firestore
      .collection("owned_games")
      .doc(steamId)
      .get();
    if (userDoc.exists) {
      await firestore
        .collection("owned_games")
        .doc(steamId)
        .update(dataToStore);
    } else {
      await firestore.collection("owned_games").doc(steamId).set(dataToStore);
    }

    const friendResponse = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${STEAM_KEY}&steamid=${steamId}&relationship=friend`
    );

    const friendsList = friendResponse.data.friendslist.friends;

  // Fetch personanames and avatarMedium for each friend
  const friendRequests = friendsList.map(async (friend) => {
    const playerSummariesResponse = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${friend.steamid}`);
    const player = playerSummariesResponse.data.response.players[0];
    return {
      steamid: friend.steamid,
      personaname: player ? player.personaname : 'Unknown', // Handle case where player is not found
      avatarMedium: player ? player.avatarmedium : 'Unknown', // Use 'avatarmedium' for medium-sized avatar
    };
  });

  // Wait for all requests to complete
  const friendsWithPersonanamesAndAvatars = await Promise.all(friendRequests);

  const friendsToStore = {
    friends: friendsWithPersonanamesAndAvatars,
  };

    const friendsDoc = await firestore.collection("friends").doc(steamId).get();
    if (friendsDoc.exists) {
      await firestore.collection("friends").doc(steamId).update(friendsToStore);
    } else {
      await firestore.collection("friends").doc(steamId).set(friendsToStore);
    }

    res.json({ success: true });
    console.log("Successfully wrote game data to Firestore");
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

app.get("/recommend/:game", async (req, res) => {
  const game = req.params.game;

  try {
    // Function to get RAWG slug based on game title
    async function getGameSlug(title) {
      try {
        const response = await axios.get(`https://api.rawg.io/api/games`, {
          params: {
            key: RAWG_KEY, // Replace with your actual API key
            search: title,
          },
        });

        const firstResult = response.data.results[0];
        return firstResult ? firstResult.slug : null;
      } catch (error) {
        console.error("Error fetching game slug:", error);
        return null;
      }
    }

    // Function to generate recommendation using OpenAI GPT-3
    async function generateRecommendation(game) {
      const input = game;
      const promptString = `
        find a game that is similar, dont use roman numerals
        input: Left 4 Dead
        output: Hunt: Showdown
        input: Path of Exile
        output: Diablo 3
        input: ${input}
        output:
      `;

      try {
        const result = await client.generateText({
          model: MODEL_NAME,
          temperature: 0.7,
          candidateCount: 1,
          top_k: 40,
          top_p: 0.95,
          max_output_tokens: 1024,
          stop_sequences: [],
          prompt: {
            text: promptString,
          },
        });

        const output = result[0]?.candidates[0]?.output; // Access output directly
        return output;
      } catch (error) {
        console.error(`Error generating recommendation for ${game}:`, error);
        return null;
      }
    }

    // Fetch the game slug and generate recommendation
    const slug = await getGameSlug(game);

    if (slug) {
      const recommendation = await generateRecommendation(slug);
      res.json({ recommendation });
    } else {
      res.status(404).json({ error: "Game not found" });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/newparty/:steamId", async (req, res) => {
  const steamId = req.params.steamId;
  const firestore = admin.firestore();
  const dataToStore = {
    steamid: steamId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const docRef = await firestore.collection("parties").add(dataToStore);
    console.log('Document written with ID:', docRef.id);

    res.json({ docid: docRef.id }); // Send the document ID in the response
  } catch (error) {
    console.error('Error adding document:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get("/recommend/getgameinfo/:game", async (req, res) => {
  const game = req.params.game;
  const rawgkey = process.env.RAWG_KEY;
  try {
    const gameinfo = await axios.get(
      `https://api.rawg.io/api/games/${game}?key=${rawgkey}`
    );

    res.json(gameinfo.data); // Sending the data as the response to the client
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// call steam api to fetch information about the given steamid
app.get("/steam/userinfo/:steamId", async (req, res) => {
  const steamId = req.params.steamId;
  const userInfo = await axios.get(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${steamId}`
  );
  console.log("userinfo: ", userInfo.data);
  res.json(userInfo.data);
});

app.get("/findgames/:docId", async (req, res) => {
  try {
    const docId = req.params.docId;

    // grabbing doc from firestore
    const partyRef = firestore.collection("parties").doc(docId);
    const partyDoc = await partyRef.get();
    console.log(partyDoc);

    // error incase doc isnt found
    if (!partyDoc.exists) {
      return res.status(404).send("party not found");
    }

    // storing data in partyData
    const partyData = partyDoc.data();
    console.log('party data: ', partyData);
    const partyMembers = partyData.partyMembers;
    console.log('party members: ', partyMembers);

    // map over each steam id in the partyMembers array
    const ownedGamesPromises = partyMembers.map(async (steamId) => {
      try {
        const steamApiResponse = await axios.get(
          `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`
        );
    
        const gamesResponse = steamApiResponse.data.response.games;
    
        if (gamesResponse && Array.isArray(gamesResponse)) {
          const ownedGames = gamesResponse.map((game) => game.appid);
          console.log(ownedGames);
          return { steamId, ownedGames };
        } else {
          console.log(`Invalid or missing games response for Steam ID ${steamId}:`, gamesResponse);
          return null; // or return an object indicating an issue, e.g., { steamId, error: 'Invalid response' }
        }
      } catch (error) {
        console.error(`Error fetching owned games for Steam ID ${steamId}:`, error);
        return null; // or return an object indicating an error, e.g., { steamId, error: error.message }
      }
    });
    
   // Filter out results where the response was null (invalid or missing)
const validResponses = (await Promise.all(ownedGamesPromises)).filter(
  (response) => response !== null
);

// Process validResponses as needed
console.log(validResponses);

const ownedGamesArrays = await Promise.all(validResponses);

const commonGames = ownedGamesArrays[0].ownedGames.filter((game) =>
  ownedGamesArrays.every((player) => player.ownedGames.includes(game))
);

res.status(200).json({ commonGames });

  } catch (error) {
    console.error("can't retrieve party data: ". error);
    res.status(500).send("internal server error");
  }

})

app.get("/auth/steam/authenticate", async (req, res) => {
  try {
    const user = await steam.authenticate(req);
    // Access user properties
    const steamId = user.steamid;
    // ... (rest of the user properties)

    customToken = await admin.auth().createCustomToken(steamId);

    // Now you can use these properties as needed

    try {
      const firestore = admin.firestore();
      const dataToStore = {
        steamid: steamId,
        // ... (rest of the user properties)
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      const userDoc = await firestore.collection("users").doc(steamId).get();

      if (userDoc.exists) {
        await firestore.collection("users").doc(steamId).update(dataToStore);
      } else {
        await firestore.collection("users").doc(steamId).set(dataToStore);
      }

      // Now that the token is generated and user data is stored, redirect or send a response.
      res.redirect("http://localhost:3000/redirect");
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "An error occurred" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Steam authentication error" });
  }
});


const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
