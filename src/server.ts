import express from 'express';
import path from 'path';
import session, {SessionData} from 'express-session';
import pool from "./db/pool";

type CustomSession = SessionData & {user?: {username: string}};

const app = express();

const externalUrl = process.env.RENDER_EXTERNAL_URL;
const port = externalUrl && process.env.PORT ? parseInt(process.env.PORT) : 4080;

app.use(session({
    secret: 'very-secret-key',
    name: 'vulnerable-app-user-cookie',
    cookie: {
        httpOnly: false
    }
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(express.urlencoded());

app.post('/login', (req, res) => {
    (req.session as CustomSession).user = { username: 'app_user' };
   res.redirect('/');
});

app.post('/logout', (req, res) => {
    res.clearCookie('vulnerable-app-user-cookie', { httpOnly: false });
    req.session.destroy((error) => {
        if (error) {
            console.error('Error destroying session:', error);
        }
        res.redirect('/');
    });
});

app.get('/', (req, res) => {
    const name = req.query.name;
    const isProtected = req.query.isProtected;
    const user = (req.session as CustomSession).user?.username;
    res.render('homepage', {name, isProtected, user});
});

app.route('/user/:user/posts')
    .get(async (req, res) => {
        const loggedInUser = (req.session as CustomSession).user?.username;
        const paramsUser = req.params.user;
        const isXSSProtected = req.query.isXSSProtected;
        const isBACProtected = req.query.isBACProtected;

        if (loggedInUser == paramsUser) {
            app.locals.isBACProtected = !!isBACProtected;
            app.locals.isXSSProtected = !!isXSSProtected;
        }

        if (!loggedInUser || (loggedInUser != paramsUser && app.locals.isBACProtected)) {
            return res.redirect('/');
        }

        let statement, params;
        if (paramsUser == 'admin') {
            statement = 'select * from post order by id desc';
            params = [];
        } else {
            statement = 'select * from post where creator = $1 order by id desc';
            params = [paramsUser];
        }
        await pool.query(statement, params).then(
            (result) => {
                const posts = result.rows;
                res.render('posts', {user: paramsUser, posts, isXSSProtected})
            },
            (error) => console.error(error)
        );
    })
    .post(async (req, res) => {
        const loggedInUser = (req.session as CustomSession).user?.username;
        const paramsUser = req.params.user;
        const text = req.body.text;

        if (!loggedInUser || loggedInUser != paramsUser) {
            return res.redirect('/');
        }

        const isXSSProtected = app.locals.isXSSProtected;
        const isBACProtected = app.locals.isBACProtected;

        let statement, params;
        if (isXSSProtected) {
            statement = 'insert into post (text, creator) values ($1, $2)';
            params = [text, loggedInUser];
        } else {
            statement = 'insert into post (text, creator) values (\'' + text + '\', \'' + loggedInUser + '\')';
            params = [];
        }

        await pool.query(statement, params).then(
            () => {
                let query = '';
                if (isXSSProtected) {
                    query += 'isXSSProtected=on&';
                }
                if (isBACProtected) {
                    query += 'isBACProtected=on';
                }
                res.redirect(`/user/${loggedInUser}/posts?${query}`)
            },
            (error) => console.error(error)
        );
    });

if (externalUrl) {
    const hostname = '0.0.0.0';
    app.listen(port, hostname, () => {
        console.log(`Server locally running at http://${hostname}:${port}/ and from outside on ${externalUrl}`);
    });
} else {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}/`);
    });
}