const pg = require("pg");
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const sharp = require("sharp");

const { hashPassword, validatePassword } = require("./passwordUtil");
const {
    createSession,
    setSessionCookie,
    getSession,
    deleteSession,
    clearSessionCookie,
    authMiddleware,
    startTokenCleanup
} = require("./sessionUtil");

const app = express();
const port = process.env.PORT || 3000;

const LOGIN_PAGE = "/src/login.html";
const IMAGE_DIR = path.join(__dirname, "public", "images");

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

// Page middleware: redirects to login instead of returning JSON,
// and exposes the session as `user` in every EJS template.
function requireLogin(req, res, next) {
    const session = getSession(req.cookies && req.cookies.token);
    if (!session) return res.redirect(LOGIN_PAGE);
    req.session = session;
    res.locals.user = session;
    next();
}

const pages = {
    auctions:        { view: "auctions",     title: "Auctions" },
    trade:           { view: "trade",        title: "Trade" },
    notifications:   { view: "notif",        title: "Notifications" },
    listings:        { view: "listings",     title: "My Listings" },
    settings:        { view: "settings",     title: "Settings" },
    itemView:        { view: "item-view",    title: "Item View" },
    auctionItemView: { view: "auction-view", title: "Auction Item View" }
};

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

        // log the new user in right away
        setSessionCookie(res, createSession(inserted.rows[0].id, username, picId));
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

// account
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

// login
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

        setSessionCookie(
            res,
            createSession(account.id, account.username, account.profile_pic_id)
        );
        return res.status(200).json({ message: "Login successful", username: account.username });
    } catch (error) {
        console.error("Login database error:", error);
        return res.status(500).json({ message: "Something went wrong" });
    }
});

// reset password
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

// logout
app.post("/logout", (req, res) => {
    deleteSession(req.cookies && req.cookies.token);
    clearSessionCookie(res);
    res.redirect(LOGIN_PAGE);
});

// current user info for client-side scripts
app.get("/api/session", authMiddleware, (req, res) => {
    res.json({
        username: req.session.username,
        profilePicId: req.session.profilePicId
    });
});

// item catalog
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

// place a bid (placeholder: bidder comes from the session, never from the body)
app.post("/auctionItemView", authMiddleware, async (req, res) => {
    try {
        const { bid } = req.body || {};
        console.log(`Bid from account ${req.session.accountId}:`, bid);

        res.status(200).json({ success: true, message: "Place bid placeholder" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Failed to place bid." });
    }
});

// collections page
app.get("/collections/:username", requireLogin, (req, res) => {
    if (req.params.username.toLowerCase() !== req.session.username.toLowerCase()) {
        return res.redirect(`/collections/${encodeURIComponent(req.session.username)}`);
    }
    res.render("collections", { active: "collections" });
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
// with yet. With search text: any account whose username matches, each
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
               AND (($3::text = '' AND f.status IS NULL)
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
        res.json({ ok: result.rowCount === 1, status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Could not update request" });
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

app.listen(port, "0.0.0.0", () => {
    console.log(`Listening on port ${port}`);
});