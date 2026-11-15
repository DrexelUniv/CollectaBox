let img = document.getElementById("image");
let itemName = document.getElementById("item-name");
let sellerUser = document.getElementById("seller-user");
let currPrice = document.getElementById("curr-price");
let bidButton = document.querySelector(".place-bid");
let buyButton = document.querySelector(".buy-now");
let bidAmount = document.querySelector(".bid-amount");
let itemDesc = document.getElementById("item-desc");
let message = document.getElementById("message");

// clicking "Place Bid" functions should send inputted value to server
bidButton.addEventListener("click", async () => {
    message.textContent = "";

    const bid = Number(bidAmount.value);

    try {
        const response = await fetch("/auctionItemView", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ bid })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message);
        }

        message.textContent = data.message;

    } catch (error) {
        console.error(error);
        message.textContent = error.message || "Something went wrong";
    }
});

// placeholder, unsure if we'll implement buyout feature
buyButton.addEventListener("click", () => {
    //TODO
});