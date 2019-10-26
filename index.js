const FormData = require('form-data')
const express = require('express')

const app = express()

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port 3000");
});

app.post('/bounce', function (req, res) {
    try {
        const {
            fileData,
            fileType,
            fileName,
            message,
            token,
            channel
        } = req.params

        var buffer = new Buffer(fileData, 'base64')
        var form = new FormData()

        form.append('file', buffer)
        form.append('token', token)
        form.append('channels', channel)
        form.append('filename', fileName)
        form.append('filetype', fileType)
        form.append('initial_comment', message)
        
        form.submit('https://slack.com/api/files.upload', function(err, response) {
            if (err) res.send(err)
            else res.send('success')
        })
    }
    catch (err) {
        res.send(err)
    }
})