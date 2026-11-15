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

function createSession(accountId, username) {
    const token = generateToken();
    tokenStore[token] = {
        accountId: accountId,
        username: username,
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

function clearSessionCookie(res) {
    res.clearCookie("token", {
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite
    });
}

function authMiddleware(req, res, next) {
    const token = req.cookies ? req.cookies.token : undefined;
    const session = getSession(token);

    if (session === undefined) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    req.session = session;
    next();
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
    getSession,
    deleteSession,
    clearSessionCookie,
    authMiddleware,
    startTokenCleanup
};