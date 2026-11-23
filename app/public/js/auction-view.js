const socket = io();

// let's frontend know what page to display
const auctionID = document.getElementById("auction-page").dataset.auctionId;

// page elements
let currPrice = document.getElementById("curr-price");
let bidButton = document.querySelector(".place-bid");
let buyButton = document.querySelector(".buy-now");
let bidAmount = document.querySelector(".bid-amount");
let itemDesc = document.getElementById("item-desc");
let message = document.getElementById("message");

// clicking "Place Bid" functions should send inputted value to server
bidButton.addEventListener("click", async () => {
    message.textContent = "";

    const currentPrice = Number(
        currPrice.textContent.replace(/[$,]/g, "")
    );

    const bid = Number(bidAmount.value);

    if (bid < currentPrice + 0.50) {
        message.textContent = `Your big must be a least $${(currentPrice + 0.50).toFixed(2)}`;
        return;
    }

    // disable button temporarily 
    bidButton.disabled = true;
    bidButton.textContent = "Placing bid...";

    try {
        const response = await fetch(`/auctionItemView/${auctionID}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                bidAmount: bid,
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message);
        }

        message.textContent = data.message;

    } catch (error) {
        console.error(error);
        message.textContent = error.message || "Something went wrong";
    } finally {
        bidButton.disabled = false;
        bidButton.textContent = "Place Bid";
    }
});

// placeholder, unsure if we'll implement buyout feature
buyButton.addEventListener("click", () => {
    // TODO: send buyout info?
});

// update displayed price
socket.on("newBid", (data) => {
    console.log("New bid:", data)
    const newPrice = data.newPrice.toLocaleString("en-US", { 
        style: "currency", 
        currency: "USD" 
    });

    currPrice.textContent = newPrice;
});

socket.emit("joinAuction", {
    auctionID: auctionID,
});