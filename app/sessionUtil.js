const crypto = require("crypto");

const SESSION_DURATION = 24 * 60 * 60 * 1000;

const tokenStore = {};

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_DURATION
};

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

function createSession(accountId, username, profilePicId) {
    const token = generateToken();
    tokenStore[token] = {
        accountId,
        username,
        profilePicId,
        createdAt: Date.now()
    };
    return token;
}

function setSessionCookie(res, token) {
    res.cookie("token", token, cookieOptions);
}

function getSession(token) {
    if (typeof token !== "string" || !Object.hasOwn(tokenStore, token)) {
        return undefined;
    }

    const session = tokenStore[token];
    if (Date.now() - session.createdAt > SESSION_DURATION) {
        delete tokenStore[token];
        return undefined;
    }
    return session;
}

function deleteSession(token) {
    if (typeof token === "string") {
        delete tokenStore[token];
    }
}

// Replace any session the request already carries with a fresh one and set
// the cookie. Use this on login/signup so old tokens don't pile up and a
// pre-login token can't be reused after authentication.
function startSession(req, res, accountId, username, profilePicId) {
    deleteSession(req.cookies && req.cookies.token);
    setSessionCookie(res, createSession(accountId, username, profilePicId));
}

// Update cached fields (e.g. username, profilePicId after a settings change)
// on the live session so templates and /api/session don't show stale data.
function updateSession(token, fields) {
    const session = getSession(token);
    if (!session) return false;
    Object.assign(session, fields);
    return true;
}

function clearSessionCookie(res) {
    res.clearCookie("token", {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite
    });
}

// API middleware: responds with JSON 403 (for fetch calls)
function authMiddleware(req, res, next) {
    const session = getSession(req.cookies ? req.cookies.token : undefined);

    if (session === undefined) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    req.session = session;
    next();
}

// Page middleware factory: redirects to the login page (for browser
// navigation) and exposes the session as `user` in every EJS template.
function requireLogin(loginPage) {
    return function (req, res, next) {
        const session = getSession(req.cookies ? req.cookies.token : undefined);

        if (session === undefined) {
            return res.redirect(loginPage);
        }

        req.session = session;
        res.locals.user = session;
        next();
    };
}

function startTokenCleanup(intervalMs = 60 * 60 * 1000) {
    const timer = setInterval(() => {
        for (const token of Object.keys(tokenStore)) {
            getSession(token);
        }
    }, intervalMs);
    timer.unref();
    return timer;
}

module.exports = {
    generateToken,
    createSession,
    setSessionCookie,
    startSession,
    updateSession,
    getSession,
    deleteSession,
    clearSessionCookie,
    authMiddleware,
    requireLogin,
    startTokenCleanup
};