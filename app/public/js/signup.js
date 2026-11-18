const MAX_PIC_BYTES = 2 * 1024 * 1024;   // matches the server's 2 MB limit
const BLANK_PIC = "/images/profile_pic_blank.png";

const button = document.getElementById("submit");
const message = document.getElementById("message");
const username = document.getElementById("username");
const email = document.getElementById("email");
const password = document.getElementById("password");
const confirm_pass = document.getElementById("confirm");
const picInput = document.getElementById("profile_pic");
const picPreview = document.getElementById("pfp-preview");

// live preview; falls back to the blank image if cleared or too large
picInput.addEventListener("change", () => {
    message.textContent = "";
    const file = picInput.files[0];

    if (!file) {
        picPreview.src = BLANK_PIC;
        return;
    }
    if (file.size > MAX_PIC_BYTES) {
        message.textContent = "Profile picture must be 2 MB or smaller";
        picInput.value = "";
        picPreview.src = BLANK_PIC;
        return;
    }
    picPreview.src = URL.createObjectURL(file);
});

button.addEventListener("click", () => {
    message.textContent = "";

    // FormData sends multipart. Do NOT set Content-Type yourself,
    // the browser adds it along with the boundary.
    const formData = new FormData();
    formData.append("username", username.value);
    formData.append("email", email.value);
    formData.append("password", password.value);
    formData.append("confirm_pass", confirm_pass.value);
    if (picInput.files[0]) {
        formData.append("profile_pic", picInput.files[0]);
    }

    fetch("/signup", {
        method: "POST",
        body: formData
    }).then((response) => {
        return response.json().then(data => ({
            status: response.status,
            data: data
        }));
    }).then((result) => {
        message.textContent = result.data.message;

        if (result.status >= 200 && result.status < 300) {
            window.location.href = `/collections/${encodeURIComponent(result.data.username)}`;
        }
    }).catch((error) => {
        console.error(error);
        message.textContent = "Something went wrong.";
    });
});