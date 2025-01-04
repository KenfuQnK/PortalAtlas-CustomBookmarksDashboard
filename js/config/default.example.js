
// Default data for initial setup
const DEFAULT_DATA = {
    wrappers: [
        {
            id: "wrapper-0",
            name: "Featured",
            order: 0
        },
        {
            id: "wrapper-1",
            name: "Example",
            order: 1
        },
    ],
    cards: [
        {
            id: "card-1",
            name: "Google",
            size: "card-wide",
            link: "https://www.google.com",
            backgroundImage: "url(https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png)",
            backgroundImageSize: "80%",
            backgroundColor: "#ffffff",
            backgroundPosition: "50,50",
            wrapperId: "wrapper-1",
            order: 0,
            showName: false
        },
        {
            id: "card-2",
            name: "YouTube",
            size: "card-big",
            link: "https://www.youtube.com",
            backgroundImage: "url(https://www.youtube.com/img/desktop/yt_1200.png)",
            backgroundImageSize: "70%",
            backgroundColor: "#ff0000",
            backgroundPosition: "50,50",
            wrapperId: "wrapper-1",
            order: 1,
            showName: true
        },
        {
            id: "card-3",
            name: "GitHub",
            size: "card-small",
            link: "https://github.com",
            backgroundImage: "url(https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)",
            backgroundImageSize: "60%",
            backgroundColor: "#24292e",
            backgroundPosition: "50,50",
            wrapperId: "wrapper-1",
            order: 2,
            isDefault: true,
            showName: true
        }
    ]
};