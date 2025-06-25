import 'dotenv/config';
import express from 'express';
import AWS from 'aws-sdk';
import mysql from 'mysql2/promise';
import multer from 'multer';
import axios from 'axios';

const app = express();
const upload = multer();

const s3 = new AWS.S3({ region: process.env.AWS_REGION });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

app.post('/add-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const filename = req.file.originalname;
    const key = `${Date.now()}_${filename}`;

    const presignedUrl = await s3.getSignedUrlPromise('putObject', {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: req.file.mimetype,
      Expires: 60,
      ACL: 'private',
    });

    await axios.put(presignedUrl, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype,
      },
    });

    const cfUrl = `${process.env.CF_DOMAIN}/${key}`;

    await db.query(
      'INSERT INTO images (filename, s3_key, cf_url, created_at) VALUES (?, ?, ?, NOW())',
      [filename, key, cfUrl]
    );

    res.json({ message: 'Image uploaded successfully via presigned URL', imageUrl: cfUrl });
  } catch (error) {
    console.error('Upload failed:', error.message);
    res.status(500).json({ error: 'Upload via presigned URL failed' });
  }
});

app.get('/images', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, filename, cf_url, created_at FROM images ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

const port = 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
