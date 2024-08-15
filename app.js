const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "socialMedia.db");

let db;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// Register
app.post("/register/", async (request, response) => {
    const { username, password } = request.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const createUserQuery = `
      INSERT INTO users (username, password)
      VALUES ('${username}', '${hashedPassword}');
    `;
    await db.run(createUserQuery);
    response.status(201).send("User created successfully");
  });
  
  // Login
  app.post("/login", async (request, response) => {
    const { username, password } = request.body;
    const getUserQuery = `
      SELECT * FROM users WHERE username = '${username}';
    `;
    const dbUser = await db.get(getUserQuery);
    if (dbUser && await bcrypt.compare(password, dbUser.password)) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({jwtToken});
    } else {
      response.status(400).send("Invalid username or password");
    }
  });
  
  // Authentication middleware
  const authenticateToken = (request, response, next) => {
    const authHeader = request.headers["authorization"];
    const jwtToken = authHeader && authHeader.split(" ")[1];
    
    if (!jwtToken) {
      return response.status(401).send("Invalid JWT Token");
    }
    
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (err, payload) => {
      if (err) return response.status(401).send("Invalid JWT Token");
      request.username = payload.username;
      next();
    });
  };

// Rate limiting middleware
const createCommentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 requests per windowMs
    message: "Too many comments created from this IP, please try again after 15 minutes",
  });
  
  // Create a comment
  app.post("/api/posts/:postId/comments/", authenticateToken, createCommentLimiter, async (request, response) => {
    const { postId } = request.params;
    const { text } = request.body;
    const userQuery = `SELECT id FROM users WHERE username = '${request.username}';`;
    const user = await db.get(userQuery);
    
    const createCommentQuery = `
      INSERT INTO comments (post_id, user_id, text)
      VALUES (${postId}, ${user.id}, '${text}');
    `;
    
    await db.run(createCommentQuery);
    response.status(201).send("Comment created successfully");
  });
  
  // Reply to a comment
  app.post("/api/posts/:postId/comments/:commentId/reply", authenticateToken, createCommentLimiter, async (request, response) => {
    const { postId, commentId } = request.params;
    const { text } = request.body;
    const userQuery = `SELECT id FROM users WHERE username = '${request.username}';`;
    const user = await db.get(userQuery);
    
    const replyCommentQuery = `
      INSERT INTO comments (post_id, user_id, text, parent_comment_id)
      VALUES (${postId}, ${user.id}, '${text}', ${commentId});
    `;
    
    await db.run(replyCommentQuery);
    response.status(201).send("Reply created successfully");
  });
  
  // Get comments with replies
  app.get("/api/posts/:postId/comments", authenticateToken, async (request, response) => {
    const { postId } = request.params;
    const { sortBy = 'created_at', sortOrder = 'desc' } = request.query;
  
    const getCommentsQuery = `
      SELECT 
        id, text, created_at, parent_comment_id 
      FROM 
        comments 
      WHERE 
        post_id = ${postId} AND parent_comment_id IS NULL 
      ORDER BY 
        ${sortBy} ${sortOrder};
    `;
  
    const comments = await db.all(getCommentsQuery);
    response.send(comments);
  });
  
  // Expand comment replies with pagination
  app.get("/api/posts/:postId/comments/:commentId/expand", authenticateToken, async (request, response) => {
    const { postId, commentId } = request.params;
    const { page = 1, pageSize = 5 } = request.query;
    const offset = (page - 1) * pageSize;
  
    const getRepliesQuery = `
      SELECT 
        id, text, created_at 
      FROM 
        comments 
      WHERE 
        post_id = ${postId} AND parent_comment_id = ${commentId} 
      ORDER BY 
        created_at DESC 
      LIMIT 
        ${pageSize} OFFSET ${offset};
    `;
  
    const replies = await db.all(getRepliesQuery);
    response.send(replies);
  });

  