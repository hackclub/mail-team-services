const FormData = require('form-data')
const express = require('express')

const app = express()

app.use(express.json())

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running on port 3000");
});

app.post('/bounce', function (req, res) {
    console.log('oh boy oh boy here comes a request!!')

    try {
        const {
            fileData,
            fileType,
            fileName,
            message,
            token,
            channel
        } = req.body

        console.log('hmmm, lots of stuff to unpack here...')

        var buffer = Buffer.from(fileData, 'base64')
        var form = new FormData()

        console.log('ok i made a buffer and a form')

        form.append('file', buffer)
        form.append('token', token)
        form.append('channels', channel)
        form.append('filename', fileName)
        form.append('filetype', fileType)
        form.append('initial_comment', message)

        console.log('yay everything is appended to the form! redy to send :))')
        
        form.submit('https://slack.com/api/files.upload', function(err, response) {
            if (err) {
                console.log('i submitted but i got error :(')
                console.log(err)
                res.send(err)
            }
            else {
                console.log('i submitted and it is good so happy!!!!!')
                console.log(response)
                res.send(response)
            }
        })
    }
    catch (err) {
        console.log('ummmmm something bad hapend :(((')
        console.log(err)
        res.send(err)
    }
})