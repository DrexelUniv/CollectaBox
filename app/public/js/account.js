document.addEventListener("DOMContentLoaded", () => {
    const displayBio = document.getElementById("bio");
    if (!displayBio) return;

    displayBio.style.cursor = "pointer";
    displayBio.title = "Change bio!";

    displayBio.addEventListener("click", async () => {
        const current = displayBio.textContent === "No bio yet" ? "" : displayBio.textContent;
        const newBio = prompt("Create new bio:", current);

        // null = user cancelled; empty string is allowed and clears the bio
        if (newBio === null) return;

        try {
            const response = await fetch("/account/bio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bio: newBio })
            });
            const data = await response.json();

            if (!response.ok) {
                alert(data.message || "Could not update bio");
                return;
            }

            displayBio.textContent = data.bio || "No bio yet";
        } catch (error) {
            console.error(error);
            alert("Something went wrong.");
        }
    });
    
    document.addEventListener("DOMContentLoaded", () => {
        let savedPfp = localStorage.getItem("currPfp");
        let pfpImages = document.querySelectorAll(".pfp-image");

        if (savedPfp && pfpImages.length > 0) {
            pfpImages.forEach((img) => {
                if (img.tagName === "IMG") {
                    img.src = savedPfp;
                } else {
                    img.style.backgroundImage = `url(${savedPfp})`;
                    img.style.backgroundSize = "cover";
                    img.style.backgroundPosition = "center";
                    img.textContent = "";
                }
            
            });
        }
    
    });
});