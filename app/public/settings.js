document.addEventListener("DOMContentLoaded", () => {
    //create pop up window
    let pfpWindow = document.getElementById("pfp-window");
    let usernameWindow = document.getElementById("username-window");

    //create functional buttons
    let changePfpBtn = document.getElementById("change-pfp-btn");
    let changeUsernameBtn = document.getElementById("change-username-btn");

    //close buttons
    let closePfp = document.getElementById("close-pfp");
    let closeUsername = document.getElementById("close-username");

    //open windows when button is pushed
    if (changePfpBtn && pfpWindow) {
        changePfpBtn.addEventListener("click", () => {
            pfpWindow.classList.toggle("show");
        });
    }

    if (closePfp && pfpWindow) {
        closePfp.addEventListener("click", () => {
            pfpWindow.classList.toggle("show");
        });
    }

    if (changeUsernameBtn && usernameWindow) {
        changeUsernameBtn.addEventListener("click", () => {
            usernameWindow.classList.toggle("show");
        });
    }

    if (closeUsername && usernameWindow) {
        closeUsername.addEventListener("click", () => {
            usernameWindow.classList.toggle("show");
        });
    }

    //save new username to user email

    let submitUsername = document.getElementById("submit-username");
    let usernameMsg = document.getElementById("username-msg");
    
    if (submitUsername) {
        submitUsername.addEventListener("click", () => {
            let newUser = document.getElementById("new-user").value;
            let confirmUser = document.getElementById("confirm-user").value;
            let userEmail = localStorage.getItem("currEmail");
        
            if (newUser !== confirmUser) {
                if (usernameMsg) usernameMsg.textContent = "Username MUST match";
                return;
            }

            if (!userEmail) {
               if (usernameMsg) usernameMsg.textContent = "Email entered not found";
                return;
            }

            fetch("/update-username", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: userEmail, newUsername: newUsername })
                    })
                    .then(response => response.json())
                    .then(data => {
                        alert(data.message);
                        localStorage.setItem("currentusername", newUsername);
                        window.location.reload();
                    }, 1000)
                    .catch(error => {
                        console.log("Error:", error);
                        if (usernameMsg) usernameMsg.textContent = "Server error";
                    });
                });
            }


});