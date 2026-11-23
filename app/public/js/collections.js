const owner = document.body.dataset.owner;
const isOwner = document.body.dataset.isOwner === "true";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const filterBtn = document.getElementById("filter-btn");
const rarityFilter = document.getElementById("rarity-filter");
const collectionRow = document.getElementById("collection-row");

let allItems = []; 

function makeCard(item) {
    const link = document.createElement("a");
    link.className = "card";
    link.href = `/itemView?id=${encodeURIComponent(item.id)}`;

    const imgBox = document.createElement("div");
    imgBox.className = "card-img";
    const img = document.createElement("img");
    img.src = item.image || "/images/placeholder.png";
    img.alt = item.name;
    img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = "/images/placeholder.png"; };
    imgBox.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
    const name = document.createElement("p");
    name.className = "card-name";
    name.textContent = item.name;
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = [item.brand, item.series].filter(Boolean).join(" · ");
    body.append(name, meta);

    link.append(imgBox, body);

    if (item.quantity > 1) {
        const qty = document.createElement("span");
        qty.className = "badge-qty";
        qty.textContent = `x${item.quantity}`;
        link.appendChild(qty);
    }
    if (item.rarity && item.rarity !== "Regular") {
        const tag = document.createElement("span");
        tag.className = "badge-secret";
        tag.textContent = item.rarity;
        link.appendChild(tag);
    }
    return link;
}

function showMessage(row, text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    row.replaceChildren(p);
}

function renderCollection() {
    const q = searchInput.value.trim().toLowerCase();
    const rarity = rarityFilter.value;

    const shown = allItems.filter((item) => {
        const text = `${item.name} ${item.brand || ""} ${item.series || ""}`.toLowerCase();
        return (!q || text.includes(q)) && (!rarity || item.rarity === rarity);
    });

    if (allItems.length === 0) {
        showMessage(collectionRow, isOwner
            ? "Your collection is empty. Find items to add them here!"
            : `${owner} hasn't added anything yet.`);
    } else if (shown.length === 0) {
        showMessage(collectionRow, "No items match your search.");
    } else {
        collectionRow.replaceChildren(...shown.map(makeCard));
    }
}

async function loadCollection() {
    try {
        const response = await fetch(`/api/collections/${encodeURIComponent(owner)}`);
        if (response.status === 403) {
            window.location.href = "/src/login.html";
            return;
        }
        if (!response.ok) throw new Error("bad response");
        const data = await response.json();
        allItems = data.items;

        const rarities = [...new Set(allItems.map((i) => i.rarity).filter(Boolean))].sort();
        for (const r of rarities) {
            const option = document.createElement("option");
            option.value = r;
            option.textContent = r;
            rarityFilter.appendChild(option);
        }
        renderCollection();
    } catch (err) {
        console.error(err);
        showMessage(collectionRow, "Could not load the collection. Try refreshing.");
    }
}

searchForm.addEventListener("submit", (e) => e.preventDefault());
searchInput.addEventListener("input", renderCollection);
rarityFilter.addEventListener("change", renderCollection);

filterBtn.addEventListener("click", () => {
    const open = rarityFilter.hidden;
    rarityFilter.hidden = !open;
    filterBtn.setAttribute("aria-expanded", String(open));
});

document.querySelectorAll(".shelf-link").forEach((button) => {
    button.addEventListener("click", () => {
        const row = button.closest(".shelf").querySelector(".shelf-row");
        row.classList.toggle("expanded");
    });
});

async function loadList(url, row, emptyText) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("bad response");
        const data = await response.json();
        if (data.items.length === 0) {
            showMessage(row, emptyText);
        } else {
            row.replaceChildren(...data.items.map(makeCard));
        }
    } catch (err) {
        console.error(err);
        showMessage(row, "Could not load this list. Try refreshing.");
    }
}

if (isOwner) {
    loadList("/api/favorites", document.getElementById("favorites-row"), "No favorites yet.");
    loadList("/api/wishlist", document.getElementById("wishlist-row"), "Your wish list is empty.");
}

loadCollection();