let button = document.getElementById("submit");
let message = document.getElementById("message");
let username = document.getElementById("username");
let password = document.getElementById("password");

button.addEventListener("click", () => {
    message.textContent = "";  //clear message

    console.log(username.value, password.value);

    fetch(`/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: username.value,
            password: password.value
        })

    }).then((response) => {
        return response.json().then(data => ({
            status: response.status,
            data: data
        }));
    }).then((result) => {
        if (result.status >= 200 && result.status < 300) {
            window.location.href = `/collections/${encodeURIComponent(result.data.username)}`;
        } else {
            message.textContent = result.data.message;
        }
    }).catch((error) => {
        console.log(error);
        message.textContent = "Something went wrong.";
    });
});
