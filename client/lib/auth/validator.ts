export const validateEmail = (email?: string) => {
    const MAX_EMAIL_LENGTH = 254;

    if (!email) {
        return "Email is required";
    }

    email = email.trim();

    if (email.length > MAX_EMAIL_LENGTH) {
        return "Email is wrong";
    }

    if (email.indexOf("@") !== email.lastIndexOf("@")) {
        return "Email is wrong";
    }

    const at = email.indexOf("@");

    if (at <= 0 || at >= email.length - 1) {
        return "Email is wrong";
    }

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);

    const dot = domain.lastIndexOf(".");

    if (local.length === 0 || dot <= 0 || dot === domain.length - 1) {
        return "Email is wrong";
    }

    return null;
};

export const validatePassword = (password?: string) => {
    const MIN_PASSWORD_LENGTH = 8;
    const MAX_PASSWORD_LENGTH = 64;

    if (!password) {
        return "Password is required";
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return "Password is too short";
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
        return "Password is too long";
    }

    return null;
};

export const validateMaxPlayers = (maxPlayers?: number) => {
    const MAX_MAX_PLAYERS_LENGTH = 16;

    if (!maxPlayers) {
        return "Explanation is required";
    }

    if (maxPlayers > MAX_MAX_PLAYERS_LENGTH) {
        return "Explanation is too long";
    }

    return null;
};

export const validateExplanation = (explanation?: string) => {
    const MAX_EXPLANATION_LENGTH = 512;

    if (!explanation) {
        return "Explanation is required";
    }

    if (explanation.length > MAX_EXPLANATION_LENGTH) {
        return "Explanation is too long";
    }

    return null;
};

export const validateTitle = (title?: string) => {
    const MAX_TITLE_LENGTH = 64;

    if (!title) {
        return "Title is required";
    }

    if (title.length > MAX_TITLE_LENGTH) {
        return "Title is too long";
    }

    return null;
};

export const validateUsername = (username?: string) => {
    const MIN_USERNAME_LENGTH = 3;
    const MAX_USERNAME_LENGTH = 16;

    if (!username) {
        return "Username is required";
    }

    if (username.length < MIN_USERNAME_LENGTH) {
        return "Username is too short";
    }

    if (username.length > MAX_USERNAME_LENGTH) {
        return "Username is too long";
    }

    if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(username)) {
        return "Username can contain lowercase letters, numbers, and periods only";
    }

    return null;
};
