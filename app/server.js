const pg = require("pg");
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");
const { Server } = require("socket.io")
const { createServer } = require("http");

const { hashPassword, validatePassword } = require("./passwordUtil");
const {
    startSession,
    deleteSession,
    clearSessionCookie,
    authMiddleware,
    requireLogin: makeRequireLogin,
    startTokenCleanup
} = require("./sessionUtil");

const app = express();
const port = process.env.PORT || 3000;

const server = createServer(app);
const io = new Server(server);

const LOGIN_PAGE = "/src/login.html";
const IMAGE_DIR = path.join(__dirname, "public", "images");

// Page middleware: redirects to login instead of returning JSON,
// and exposes the session as `user` in every EJS template.
// (API routes use authMiddleware, which returns a JSON 403.)
const requireLogin = makeRequireLogin(LOGIN_PAGE);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const env = require("../env.json");
const pool = new pg.Pool(env);

pool.connect()
    .then(function (client) {
        console.log(`Connected to database ${env.database}`);
        client.release();
    })
    .catch(function (err) {
        console.error("Database connection failed:", err.message);
    });

// keep the upload in memory; sharp validates it and writes the final file
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error("INVALID_TYPE"));
    }
});

function profilePicPath(id) {
    return path.join(IMAGE_DIR, `profile_${id}.png`);
}

// public URL of a profile picture (files are saved by profilePicPath above
// and served by express.static), or null so the page shows an initials circle
function profilePicUrl(id) {
    return id ? `/images/profile_${id}.png` : null;
}

app.use(express.json());
app.use(cookieParser());
startTokenCleanup();
app.use(express.static(path.join(__dirname, "public")));

const pages = {
    trade:           { view: "trade",        title: "Trade" },
    notifications:   { view: "notif",        title: "Notifications" },
    listings:        { view: "listings",     title: "My Listings" },
    settings:        { view: "settings",     title: "Settings" },
    itemView:        { view: "item-view",    title: "Item View" },
    auctionItemView: { view: "auction-view", title: "Auction Item View" }
};

// ---------------------------------------------------------------------------
// signup
// ---------------------------------------------------------------------------

// signup (multipart form: text fields + optional profile_pic file)
app.post("/signup", (req, res, next) => {
    upload.single("profile_pic")(req, res, (err) => {
        if (!err) return next();
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "Profile picture must be 2 MB or smaller" });
        }
        if (err.message === "INVALID_TYPE") {
            return res.status(400).json({ message: "Profile picture must be a PNG, JPG, or WebP" });
        }
        console.error(err);
        return res.status(400).json({ message: "Could not upload profile picture" });
    });
}, async (req, res) => {
    const { username, email, password, confirm_pass } = req.body || {};

    if (typeof username !== "string" || username.length < 1 || username.length > 25) {
        return res.status(400).json({ message: "Please enter valid username" });
    }
    if (typeof email !== "string" || email.length < 1) {
        return res.status(400).json({ message: "Please enter valid email" });
    }
    if (typeof password !== "string" || password.length < 1 ||
        typeof confirm_pass !== "string" || confirm_pass.length < 1) {
        return res.status(400).json({ message: "Password fields cannot be left empty" });
    }
    if (password !== confirm_pass) {
        return res.status(400).json({ message: "Password must match" });
    }

    let picId = null;   // null = blank placeholder image

    try {
        const hashedPassword = await hashPassword(password);

        if (req.file) {
            picId = crypto.randomBytes(16).toString("hex");
            try {
                await sharp(req.file.buffer)
                    .resize(256, 256, { fit: "cover" })
                    .png()
                    .toFile(profilePicPath(picId));
            } catch (imgErr) {
                // sharp rejects files that aren't really images
                picId = null;
                return res.status(400).json({ message: "That file is not a valid image" });
            }
        }

        const inserted = await pool.query(
            `INSERT INTO accounts (username, email, password_hash, profile_pic_id)
             VALUES ($1, $2, $3, $4)
                 RETURNING id`,
            [username, email, hashedPassword, picId]
        );

        // log the new user in right away (replaces any existing session)
        startSession(req, res, inserted.rows[0].id, username, picId);
        return res.status(200).json({ message: "Account Created!" });
    } catch (error) {
        console.error(error);

        // don't leave an orphaned image if the insert failed
        if (picId) fs.unlink(profilePicPath(picId), () => {});

        // 23505 = unique_violation
        if (error.code === "23505") {
            if (error.constraint === "accounts_email_key") {
                return res.status(409).json({ message: "An account already exists with that email" });
            }
            if (error.constraint === "accounts_username_key") {
                return res.status(409).json({ message: "An account already exists with that username" });
            }
            return res.status(409).json({ message: "An account already exists with that email or username" });
        }

        return res.status(500).json({ message: "Could not create account" });
    }
});

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

app.get("/account", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT username, email, profile_pic_id, bio FROM accounts WHERE id = $1",
            [req.session.accountId]
        );

        if (result.rows.length === 0) {
            // account was deleted while the session was still active
            deleteSession(req.cookies.token);
            clearSessionCookie(res);
            return res.redirect(LOGIN_PAGE);
        }

        res.render("account", { active: "account", account: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).send("Could not load your account");
    }
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

app.post("/login", async (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== "string" || username.length < 1 || username.length > 25) {
        return res.status(400).json({ message: "Please enter valid username" });
    }
    if (typeof password !== "string" || password.length < 1) {
        return res.status(400).json({ message: "Please enter password" });
    }

    try {
        const result = await pool.query(
            "SELECT id, username, password_hash, profile_pic_id FROM accounts WHERE username = $1",
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        const account = result.rows[0];

        let validPassword = false;
        try {
            validPassword = await validatePassword(password, account.password_hash);
        } catch (err) {
            validPassword = false;   // malformed stored hash
        }

        if (!validPassword) {
            return res.status(401).json({ message: "Invalid username or password" });
        }

        // replaces any existing session so old tokens don't pile up
        startSession(req, res, account.id, account.username, account.profile_pic_id);
        return res.status(200).json({ message: "Login successful", username: account.username });
    } catch (error) {
        console.error("Login database error:", error);
        return res.status(500).json({ message: "Something went wrong" });
    }
});

// ---------------------------------------------------------------------------
// reset-password
// ---------------------------------------------------------------------------

// NOTE: still unauthenticated. Anyone who knows an email can change that
// account's password. Add an emailed token or require login before launch.
app.post("/reset-password", async (req, res) => {
    const { email, password, confirm_pass } = req.body || {};

    if (typeof email !== "string" || email.length < 1) {
        return res.status(400).json({ message: "Please enter valid email" });
    }
    if (typeof password !== "string" || password.length < 1) {
        return res.status(400).json({ message: "Please enter a new password" });
    }
    if (password !== confirm_pass) {
        return res.status(400).json({ message: "Passwords must match" });
    }

    try {
        const hashedPassword = await hashPassword(password);

        const result = await pool.query(
            "UPDATE accounts SET password_hash = $1 WHERE email = $2",
            [hashedPassword, email]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "No account found with that email" });
        }

        return res.status(200).json({ message: "Password updated!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Could not reset password" });
    }
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

app.post("/logout", (req, res) => {
    deleteSession(req.cookies && req.cookies.token);
    clearSessionCookie(res);
    res.redirect(LOGIN_PAGE);
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

// current user info for client-side scripts
app.get("/api/session", authMiddleware, (req, res) => {
    res.json({
        username: req.session.username,
        profilePicId: req.session.profilePicId
    });
});

// ---------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------

app.get("/items", authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, brand, series, image, rarity
             FROM items
             ORDER BY brand, series, name`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Error fetching items:", error);
        res.status(500).json({ message: "Could not retrieve collectibles" });
    }
});

// add item to the logged-in user's collection
app.post("/itemView", authMiddleware, async (req, res) => {
    const itemID = Number.parseInt(req.body && req.body.itemID, 10);
    if (!Number.isInteger(itemID)) {
        return res.status(400).json({ success: false, message: "Invalid item" });
    }

    try {
        await pool.query(
            "INSERT INTO collection_items (account_id, item_id) VALUES ($1, $2)",
            [req.session.accountId, itemID]
        );
        res.status(200).json({ success: true, message: "Added to collection" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Could not add to collection" });
    }
});

// ---------------------------------------------------------------------------
// auction
// ---------------------------------------------------------------------------

// place a bid (placeholder: bidder comes from the session, never from the body)
app.post("/auctionItemView/:auctionID", authMiddleware, async (req, res) => {
    try {
        const { bidAmount } = req.body || {};
        const auctionId = req.params.auctionID;
        const bidderId = req.session.accountId;
        

        const auctionInfo = await pool.query(
            `SELECT current_highest_bid, seller_id FROM auctions WHERE id = $1`,
            [auctionId]
        );

        if (auctionInfo.rows.length === 0) {
            return res.status(404).json({ success: false, message: "404: Auction not found" });
        }

        console.log(`Bid from account ${bidderId}:`, bidAmount);

        // validate bid
        if (Number(bidderId) === Number(auctionInfo.rows[0].seller_id)) {
            return res.status(400).json({ success: false, message: "Cannot bid on your own auction listing" });
        }

        if (!Number.isFinite(bidAmount) || bidAmount < 0.01 || bidAmount <= auctionInfo.rows[0].current_highest_bid) {
            return res.status(400).json({ success: false, message: "Invalid bid amount" });
        }

        // TOOD: update db with new bid
        const updatedPrice = await pool.query (
            `UPDATE auctions 
            SET current_highest_bid = $1, 
                current_highest_bidder_id = $2
            WHERE id= $3 
                AND current_highest_bid + 0.50 <= $1
                AND status = 'open'
                AND end_time > NOW()
            RETURNING current_highest_bid`,
            [bidAmount, bidderId, auctionId]
        );

        // check row count before updating page
        if (updatedPrice.rowCount === 0) {
            return res.status(409).json({ success: false, message: "Bid not accepted. The auction may have ended or someone placed a higher bid" })
        }

        // after successful db update:
        io.to(String(auctionId)).emit("newBid", {
            newPrice: updatedPrice.rows[0].current_highest_bid
        })

        res.status(200).json({ success: true, message: "Bid placed successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to place bid." });
    }
});

// connect to live auction
app.get("/auctionItemView/:auctionID", requireLogin, async (req, res) => {
    const auctionID = req.params.auctionID;

    try {
        const results = await pool.query(
          `SELECT
                a.id AS auction_id,
                a.starting_price,
                a.current_highest_bid,
                a.current_highest_bidder_id,
                a.end_time,
                a.status,

                ci.item_id,

                i.name AS item_name,
                i.brand AS item_brand,
                i.series AS item_series,
                i.quality AS item_quality,
                i.image AS item_image,
                i.rarity AS item_rarity,

                ac.username AS seller_username

            FROM auctions a
            JOIN collection_items ci ON a.collection_item_id = ci.id
            JOIN items i ON ci.item_id = i.id
            JOIN accounts ac ON a.seller_id = ac.id
            WHERE a.id = $1;`,
          [auctionID]  
        );

        // validate auction's existence
        if (results.rows.length === 0) {
            return res.status(404).json({ success: false, message: "404: Auction not found" });
        }

        const row = results.rows[0]; 

        const auctionDetails = {
            id: row.auction_id,
            seller_username: row.seller_username,
            starting_price: row.starting_price,
            current_highest_bid: row.current_highest_bid,
            current_highest_bidder_id: row.current_highest_bidder_id,
            end_time: row.end_time,
            status: row.status
        };

        const itemDetails = {
            id: row.item_id,
            name: row.item_name,
            brand: row.item_brand,
            series: row.item_series,
            quality: row.item_quality,
            image: row.item_image,
            rarity: row.item_rarity
        }

        res.render("auction-view", {
            active: "auctionItemView",
            auctionID: auctionDetails.id,
            auction: auctionDetails,
            itemDetails: itemDetails
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
    
})

// ---------------------------------------------------------------------------
// WebSockets (Live Auction)
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
    console.log("socket.id", socket.id);

    socket.on("joinAuction", async (data) => {
        try {    const auctionID = Number(data?.auctionID);

            // validate auction existence
            if (!Number.isSafeInteger(auctionID) || auctionID <= 0) {
                return;
            }

            const result = await pool.query(
                "SELECT id FROM auctions WHERE id = $1",
                [auctionID]
            );

            if (results.rows.length === 0) {
                return;
            }

            socket.join(String(auctionID));
        } catch (error) {
            console.error("Could not join auction:", error);
        }

    });
});

// ---------------------------------------------------------------------------
// collections (home page)
// ---------------------------------------------------------------------------

// collections page: your own, or an accepted friend's
app.get("/collections/:username", requireLogin, async (req, res) => {
    const me = req.session.username;
    const target = req.params.username;

    if (target.toLowerCase() === me.toLowerCase()) {
        return res.render("collections", { active: "collections", owner: me, isOwner: true });
    }

    try {
        const result = await pool.query(
            `SELECT a.username
             FROM accounts a
                      JOIN friendships f
                           ON (f.requester_id = $1 AND f.addressee_id = a.id)
                               OR (f.addressee_id = $1 AND f.requester_id = a.id)
             WHERE LOWER(a.username) = LOWER($2)
               AND f.status = 'accepted'`,
            [req.session.accountId, target]
        );

        // not a friend (or no such user): send them back to their own page
        if (result.rows.length === 0) {
            return res.redirect(`/collections/${encodeURIComponent(me)}`);
        }

        res.render("collections", {
            active: "collections",
            owner: result.rows[0].username,
            isOwner: false
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Could not load collection");
    }
});

// ---------------------------------------------------------------------------
// friends
// ---------------------------------------------------------------------------

// Page: plain /friends redirects to /friends/<your username>
app.get("/friends", requireLogin, (req, res) => {
    res.redirect(`/friends/${encodeURIComponent(req.session.username)}`);
});

// Page: same pattern as collections
app.get("/friends/:username", requireLogin, (req, res) => {
    if (req.params.username.toLowerCase() !== req.session.username.toLowerCase()) {
        return res.redirect(`/friends/${encodeURIComponent(req.session.username)}`);
    }
    res.render("friends", { active: "friends" });
});

// Data for the My Friends and Pending Requests tabs
app.get("/api/friends", authMiddleware, async (req, res) => {
    const me = req.session.accountId;

    try {
        // Accepted friends: the other person in each friendship,
        // whichever side sent the request
        const friends = await pool.query(
            `SELECT a.username, a.profile_pic_id
             FROM friendships f
                      JOIN accounts a
                           ON a.id = CASE WHEN f.requester_id = $1
                                              THEN f.addressee_id
                                          ELSE f.requester_id END
             WHERE (f.requester_id = $1 OR f.addressee_id = $1)
               AND f.status = 'accepted'
             ORDER BY a.username`,
            [me]
        );

        // Incoming requests: people who requested me
        const pending = await pool.query(
            `SELECT a.username, a.profile_pic_id
             FROM friendships f
                      JOIN accounts a ON a.id = f.requester_id
             WHERE f.addressee_id = $1
               AND f.status = 'pending'
             ORDER BY a.username`,
            [me]
        );

        const shape = r => ({
            username: r.username,
            photo: profilePicUrl(r.profile_pic_id)
        });

        res.json({
            friends: friends.rows.map(shape),
            pending: pending.rows.map(shape)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not load friends" });
    }
});

// Add Friends tab. No search text: people you have no friendship or request
// with yet, plus people you've already sent a request to (they stay on screen
// as "Requested"). With search text: any account whose username matches, each
// labelled with its relation to you.
app.get("/api/accounts/search", authMiddleware, async (req, res) => {
    const me = req.session.accountId;
    const q = String(req.query.q || "").trim().slice(0, 25);

    // escape LIKE wildcards so "_" and "%" are matched literally
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

    try {
        const { rows } = await pool.query(
            `SELECT a.username, a.profile_pic_id, f.status,
                    (f.requester_id = $1) AS i_sent
             FROM accounts a
                      LEFT JOIN friendships f
                                ON (f.requester_id = $1 AND f.addressee_id = a.id)
                                    OR (f.addressee_id = $1 AND f.requester_id = a.id)
             WHERE a.id <> $1
               AND (($3::text = '' AND (f.status IS NULL
                                       OR (f.status = 'pending' AND f.requester_id = $1)))
                 OR ($3::text <> '' AND a.username ILIKE $2))
             ORDER BY a.username
                 LIMIT 30`,
            [me, pattern, q]
        );

        res.json(rows.map(r => ({
            username: r.username,
            photo: profilePicUrl(r.profile_pic_id),
            relation: r.status === "accepted" ? "friends"
                : r.status === "pending" ? (r.i_sent ? "sent" : "received")
                    : "none"
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search failed" });
    }
});

// Send a friend request
app.post("/api/friends/request", authMiddleware, async (req, res) => {
    const target = req.body && req.body.username;
    if (typeof target !== "string" || target.length < 1 || target.length > 25) {
        return res.status(400).json({ ok: false, message: "Invalid username" });
    }

    try {
        const result = await pool.query(
            `INSERT INTO friendships (requester_id, addressee_id, status)
             SELECT me.id, a.id, 'pending'
             FROM accounts me, accounts a
             WHERE me.id = $1
               AND LOWER(a.username) = LOWER($2)
               AND a.id <> me.id
               AND NOT EXISTS (
                 SELECT 1 FROM friendships f
                 WHERE (f.requester_id = me.id AND f.addressee_id = a.id)
                    OR (f.requester_id = a.id AND f.addressee_id = me.id)
             )`,
            [req.session.accountId, target]
        );

        // rowCount 0 = no such user, yourself, or a friendship/request already exists
        res.json({ ok: result.rowCount === 1 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Could not send request" });
    }
});

// Accept or decline an incoming friend request.
// The request row already exists (requester -> me), so this updates its status.
app.post("/api/friends/respond", authMiddleware, async (req, res) => {
    const { username, action } = req.body || {};
    const status = action === "accept" ? "accepted"
        : action === "decline" ? "declined"
            : null;
    if (typeof username !== "string" || username.length < 1 || username.length > 25 || !status) {
        return res.status(400).json({ ok: false, message: "Invalid request" });
    }

    try {
        const result = await pool.query(
            `UPDATE friendships f
             SET status = $3
                 FROM accounts r
             WHERE r.id = f.requester_id
               AND LOWER(r.username) = LOWER($2)
               AND f.addressee_id = $1
               AND f.status = 'pending'`,
            [req.session.accountId, username, status]
        );
        // rowCount 0 = no pending request from that user
        res.json({ ok: result.rowCount === 1, status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Could not update request" });
    }
});

// Cancel a friend request I sent (only while it is still pending).
// Deleting the row also lets either side send a fresh request later.
app.post("/api/friends/cancel", authMiddleware, async (req, res) => {
    const target = req.body && req.body.username;
    if (typeof target !== "string" || target.length < 1 || target.length > 25) {
        return res.status(400).json({ ok: false, message: "Invalid username" });
    }

    try {
        const result = await pool.query(
            `DELETE FROM friendships f
                 USING accounts a
             WHERE a.id = f.addressee_id
               AND LOWER(a.username) = LOWER($2)
               AND f.requester_id = $1
               AND f.status = 'pending'`,
            [req.session.accountId, target]
        );
        // rowCount 0 = no pending request from me to that user
        res.json({ ok: result.rowCount === 1 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Could not cancel request" });
    }
});


// "/" goes to the home page (logged-out users get bounced to login by requireLogin)
app.get("/", requireLogin, (req, res) => {
    res.redirect(`/collections/${encodeURIComponent(req.session.username)}`);
});

// page routes (registered last)
Object.entries(pages).forEach(([route, { view, title }]) => {
    app.get("/" + route, requireLogin, (req, res) => {
        const viewExists = fs.existsSync(path.join(__dirname, "views", view + ".ejs"));

        if (viewExists) {
            res.render(view, { active: route });
        } else {
            res.status(404).send(`${title} page coming soon`);
        }
    });
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Listening on port ${port}`);
});