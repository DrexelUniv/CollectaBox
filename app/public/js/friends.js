let friends = [];
let pending = [];
let results = [];
let searchTimer;

const grid = document.getElementById("grid");
const searchForm = document.getElementById("search-form");
const search = document.getElementById("search-input");
const tabs = document.querySelectorAll(".tab");
const pendingCount = document.getElementById("pendingCount");
let activeTab = "friends";

function updateBadge() {
    pendingCount.textContent = pending.length;
    pendingCount.hidden = pending.length === 0;
}

async function respond(f, action, buttons) {
    const row = buttons[0].parentNode;
    const old = row.querySelector(".error");
    if (old) old.remove();
    buttons.forEach(b => { b.disabled = true; });
    try {
        const res = await fetch("/api/friends/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: f.username, action })
        });
        const data = await res.json().catch(() => ({}));
        console.log("respond:", res.status, data);
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
    } catch (err) {
        console.error("Could not update request:", err);
        buttons.forEach(b => { b.disabled = false; });
        const msg = document.createElement("span");
        msg.className = "error";
        msg.textContent = "Couldn't update. Try again.";
        row.append(msg);
        return;
    }
    pending = pending.filter(p => p !== f);
    if (action === "accept") {
        friends.push(f);
        friends.sort((a, b) => a.username.localeCompare(b.username));
    }
    updateBadge();
    render();
}

// cancel a request I sent (shown on "Requested" cards in the Add Friends tab)
async function cancelRequest(f, button) {
    const row = button.parentNode;
    const old = row.querySelector(".error");
    if (old) old.remove();
    button.disabled = true;
    try {
        const res = await fetch("/api/friends/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: f.username })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
    } catch (err) {
        console.error("Could not cancel request:", err);
        button.disabled = false;
        const msg = document.createElement("span");
        msg.className = "error";
        msg.textContent = "Couldn't cancel. Try again.";
        row.append(msg);
        return;
    }
    f.relation = "none";
    render();
}

function initials(name) {
    return name.replace(/[^a-z0-9]/gi, " ").trim().split(/\s+/).slice(0, 2)
        .map(w => w[0]).join("").toUpperCase() || "?";
}

function card(f, mode) {
    // cards that contain buttons can't themselves be buttons
    const hasActions = mode === "pending" || (mode === "add" && f.relation === "sent");
    const b = document.createElement(hasActions ? "div" : "button");
    b.className = "friend";
    if (!hasActions) b.type = "button";
    b.title = f.username;

    const av = document.createElement("div");
    av.className = "avatar";
    const showInitials = () => { av.textContent = initials(f.username); };
    if (f.photo) {
        const img = new Image();
        img.alt = "";
        img.onerror = () => { img.remove(); showInitials(); };
        img.src = f.photo;
        av.appendChild(img);
    } else {
        showInitials();
    }

    const nm = document.createElement("span");
    nm.className = "name";
    nm.textContent = f.username;

    b.append(av, nm);

    if (mode === "pending") {
        const row = document.createElement("div");
        row.className = "actions";
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "accept";
        accept.textContent = "Accept";
        const decline = document.createElement("button");
        decline.type = "button";
        decline.className = "decline";
        decline.textContent = "Decline";
        accept.addEventListener("click", () => respond(f, "accept", [accept, decline]));
        decline.addEventListener("click", () => respond(f, "decline", [accept, decline]));
        row.append(accept, decline);
        b.append(row);
        return b;
    }

    if (mode === "add") {
        const st = document.createElement("span");
        st.className = "status";
        const labels = { none: "Add friend", sent: "Requested", received: "Wants to be friends", friends: "Friends" };
        st.textContent = labels[f.relation];
        b.append(st);

        if (f.relation === "sent") {
            const row = document.createElement("div");
            row.className = "actions";
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "decline";
            cancel.textContent = "Cancel request";
            cancel.addEventListener("click", () => cancelRequest(f, cancel));
            row.append(cancel);
            b.append(row);
            return b;
        }

        b.disabled = f.relation !== "none";
        b.addEventListener("click", async () => {
            try {
                const res = await fetch("/api/friends/request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username: f.username })
                });
                if ((await res.json()).ok) {
                    f.relation = "sent";
                    render();   // re-render so the card gets its Cancel button
                }
            } catch (err) {
                console.error(err);
            }
        });
        return b;
    }

    b.addEventListener("click", () => {
        window.location.href = `/collections/${encodeURIComponent(f.username)}`;
    });
    return b;
}

function emptyMessage(text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    return p;
}

function render() {
    grid.replaceChildren();
    const q = search.value.trim().toLowerCase();

    if (activeTab === "add") {
        if (results.length === 0) {
            return grid.append(emptyMessage(q ? `No accounts match “${q}”.` : "No one to add right now."));
        }
        results.forEach(r => grid.append(card(r, "add")));
        return;
    }

    const list = activeTab === "friends" ? friends : pending;
    const shown = list.filter(f => f.username.toLowerCase().includes(q));

    if (shown.length === 0) {
        if (q) grid.append(emptyMessage(`No friends match “${q}”.`));
        else if (activeTab === "friends") grid.append(emptyMessage("No friends yet. Try the Add Friends tab."));
        else grid.append(emptyMessage("No pending requests."));
        return;
    }
    shown.forEach(f => grid.append(card(f, activeTab === "pending" ? "pending" : undefined)));
}

async function load() {
    try {
        const res = await fetch("/api/friends");
        if (!res.ok) throw new Error(res.status);
        ({ friends, pending } = await res.json());
    } catch (err) {
        console.error("Could not load friends:", err);
    }
    updateBadge();
    render();
}

async function runSearch() {
    const q = search.value.trim();
    try {
        const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(res.status);
        if (q !== search.value.trim()) return; // user kept typing; ignore stale response
        results = await res.json();
    } catch (err) {
        console.error(err);
        results = [];
    }
    render();
}

tabs.forEach(t => t.addEventListener("click", () => {
    activeTab = t.dataset.tab;
    tabs.forEach(x => x.setAttribute("aria-selected", String(x === t)));
    search.value = "";
    results = [];
    search.placeholder = "Search by username";
    if (activeTab === "add") runSearch(); else render();
}));

search.addEventListener("input", () => {
    if (activeTab !== "add") return render();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
});

searchForm.addEventListener("submit", e => e.preventDefault()); // don't reload on Enter

load();