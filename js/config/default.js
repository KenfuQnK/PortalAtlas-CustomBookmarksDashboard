// Default data installed only when Portal Atlas has no existing dashboard.
// Remote images use the v2 schema and are cached locally when Chrome permits it.
const DEFAULT_DATA = {
    wrappers: [
        {
            id: 'default-wrapper-0',
            name: 'Favourites',
            order: 0
        }
    ],
    cards: [
        {
            id: '35239115-cad6-45bf-85b2-aba3caa484fe',
            name: 'YouTube',
            link: 'https://www.youtube.com/',
            wrapperId: 'default-wrapper-0',
            order: 0,
            imageKind: 'url',
            backgroundImage: 'url(https://cdn.tgdd.vn/Files/2023/10/25/1552983/yt_c2-251023-114219-800-resize.jpg)',
            size: 'card-big',
            backgroundImageSize: '190%',
            backgroundColor: '#ff4d4d',
            backgroundPosition: '50,50',
            showName: true
        },
        {
            id: 'd5efd0ad-31d4-4d5c-8130-1edd1dc8f271',
            name: 'Google',
            link: 'https://www.google.com',
            wrapperId: 'default-wrapper-0',
            order: 1,
            imageKind: 'url',
            backgroundImage: 'url(https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/1200px-Google_2015_logo.svg.png)',
            size: 'card-wide',
            backgroundImageSize: '85%',
            backgroundColor: '#f0f5ff',
            backgroundPosition: '50,50',
            showName: false
        },
        {
            id: '417a08fb-a4fc-4160-b7f3-4dd53ea3acd6',
            name: 'Facebook',
            link: 'https://www.facebook.com',
            wrapperId: 'default-wrapper-0',
            order: 2,
            imageKind: 'url',
            backgroundImage: 'url(https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Facebook_logo_%28square%29.png/600px-Facebook_logo_%28square%29.png)',
            size: 'card-small',
            backgroundImageSize: '100%',
            backgroundColor: '#38569e',
            backgroundPosition: '50,50',
            showName: true
        },
        {
            id: 'cf8aa5cc-c379-4d7e-b898-2fa0cffa4ac5',
            name: 'Instagram',
            link: 'https://www.instagram.com/',
            wrapperId: 'default-wrapper-0',
            order: 3,
            imageKind: 'url',
            backgroundImage: 'url(https://img.freepik.com/vector-gratis/logotipo-instagram_1199-122.jpg?semt=ais_hybrid)',
            size: 'card-small',
            backgroundImageSize: '105%',
            backgroundColor: '#000000',
            backgroundPosition: '50,100',
            showName: true
        },
        {
            id: '7194a524-b7f2-4a4a-b579-01280803a694',
            name: 'Wikipedia',
            link: 'https://www.wikipedia.org/',
            wrapperId: 'default-wrapper-0',
            order: 4,
            imageKind: 'url',
            backgroundImage: 'url(https://upload.wikimedia.org/wikipedia/commons/0/07/Wikipedia_logo_%28svg%29.svg)',
            size: 'card-small',
            backgroundImageSize: '75%',
            backgroundColor: '#464444',
            backgroundPosition: '50,20',
            showName: true
        },
        {
            id: 'e8cf62ae-d3d1-4b32-b76e-37d242f9a932',
            name: 'Reddit',
            link: 'https://www.reddit.com/',
            wrapperId: 'default-wrapper-0',
            order: 5,
            imageKind: 'url',
            backgroundImage: 'url(https://www.iconpacks.net/icons/2/free-reddit-logo-icon-2436-thumb.png)',
            size: 'card-small',
            backgroundImageSize: '105%',
            backgroundColor: '#ff4500',
            backgroundPosition: '50,185',
            showName: true
        },
        {
            id: 'd078c3c7-0970-4e3e-8594-ffdf7c5671da',
            name: 'X',
            link: 'https://x.com/',
            wrapperId: 'default-wrapper-0',
            order: 6,
            imageKind: 'url',
            backgroundImage: 'url(https://img.freepik.com/vector-gratis/nuevo-diseno-icono-x-logotipo-twitter-2023_1017-45418.jpg)',
            size: 'card-small',
            backgroundImageSize: '100%',
            backgroundColor: '#000000',
            backgroundPosition: '50,50',
            showName: false
        }
    ]
};
