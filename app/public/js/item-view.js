let img = document.getElementById("image");
let itemName = document.getElementById("item-name");
let itemIP = document.getElementById("item-ip");
let itemSeries = document.getElementById("item-series");
let collectionButton = document.querySelector(".add-collection");
let wishlistButton = document.querySelector(".add-wishlist");
let auctionButton = document.querySelector(".to-auction");
let itemDesc = document.getElementById("item-desc");
let auctionStatus = document.querySelector(".auction-status");
let auctionFormOverlay = document.getElementById("form-overlay");

// clicking "Add to Collection" button adds item to user's collection
collectionButton.addEventListener("click", () => {
    //TODO 
    fetch(`/itemView`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }, 
        body: JSON.stringify({
            itemID: 123
        })
    })
});

// clicking "Add to Wishlist" button adds item to user's wishlist collection
const itemId = new URLSearchParams(window.location.search).get("id");

wishlistButton.addEventListener("click", async () => {
    //TODO
        try {
        const response = await fetch("/api/wishlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemID: itemId })
        });
        if (!response.ok) throw new Error("request failed");
        wishlistButton.lastChild.textContent = " On your wishlist"; // keeps the heart icon
        wishlistButton.disabled = true;
    } catch (err) {
        console.error(err);
        wishlistButton.lastChild.textContent = " Could not add. Try again";
    }
});

// clicking "Put up for Auction pulls up auction form overlay"
auctionButton.addEventListener("click", () => {
    //TODO
    auctionFormOverlay.style.display = "flex";
})

// clicking outside overlay closes it
auctionFormOverlay.addEventListener("click", (event) => {
    if (event.target === auctionFormOverlay) {
        auctionFormOverlay.style.display = "none";
    }
});